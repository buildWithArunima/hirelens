// backend/src/api/analyze.js
// Rubric-based assignment review: repo + criteria + rubric -> scored report.

import { changeCounts, citesOnlyStarterCode, fetchRepoSnapshot, hasNoChanges } from "../lib/githubFetcher.js";
import { chatJson } from "../lib/claudeClient.js";
import { normalizeRubric, pointsFor, recommendationFor, RATINGS } from "../lib/rubric.js";
import { verifyEvidence, TRUSTED_STATUSES } from "../lib/evidence.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewPrompt } from "../prompts/reviewPrompt.js";

const REQUIREMENT_STATUSES = new Set(["met", "partial", "not_met", "unclear"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * @param {object} input
 * @param {string} input.repo       GitHub URL (or a local folder path)
 * @param {string} [input.criteria] What the candidate was asked to build
 * @param {string|object[]} input.rubric  Rubric as text or JSON
 * @param {Function} [input.llm]    Override the model call (tests)
 * @param {string} [input.starter]  Repo the candidate started from (GitHub URL or local folder)
 * @param {object} [input.fetchOptions]  maxFiles / maxFileChars / maxTotalChars
 * @param {object} [input.snapshot] Already-fetched repo snapshot (skips the fetch)
 */
export async function reviewAssignment({ repo, criteria = "", rubric, llm, fetchOptions, starter, snapshot: given } = {}) {
  if (!repo && !given) throw new Error("repo is required");
  const normalizedRubric = normalizeRubric(rubric);
  const snapshot = given || await fetchRepoSnapshot(repo, { ...fetchOptions, ...(starter && { starter }) });
  if (!snapshot.files.length) throw new Error("No reviewable source files found in the repo");

  const raw = await chatJson({
    system: REVIEW_SYSTEM_PROMPT,
    user: buildReviewPrompt({ snapshot, criteria, rubric: normalizedRubric }),
    maxTokens: 8192,
    ...(llm && { llm }),
  });

  return buildReport({ raw, snapshot, rubric: normalizedRubric, criteria });
}

// Exported separately so it can be unit tested without a model.
export function buildReport({ raw, snapshot, rubric, criteria = "" }) {
  const byId = new Map((raw.items || []).map(it => [String(it.rubricId || "").trim(), it]));

  const items = rubric.items.map(ri => {
    const it = byId.get(ri.id) || (raw.items || []).find(x => norm(x.criterion) === norm(ri.criterion));
    if (!it) {
      return {
        ...ri,
        rating: "not_assessable",
        ratingLabel: RATINGS.not_assessable.label,
        points: null,
        confidence: "low",
        summary: "The model did not return a rating for this item. Review it manually.",
        evidence: [],
        improvementTip: "",
        probeQuestion: "",
        warnings: ["missing_from_model_output"],
      };
    }

    let rating = RATINGS[it.rating] ? it.rating : "not_assessable";
    const evidence = (Array.isArray(it.evidence) ? it.evidence : []).slice(0, 6).map(ev => tagStarterCode(verifyEvidence(ev, snapshot), snapshot));
    const trusted = evidence.filter(ev => TRUSTED_STATUSES.has(ev.status));
    let confidence = CONFIDENCE.has(it.confidence) ? it.confidence : "medium";
    const warnings = [];

    // A positive rating needs at least one piece of evidence we could locate.
    if (["strong", "meets", "partial"].includes(rating) && !trusted.some(ev => ev.kind === "strength")) {
      confidence = "low";
      warnings.push("no_verified_evidence");
    }
    if (evidence.some(ev => ev.status === "file_not_found" || ev.status === "quote_not_found")) {
      warnings.push("some_evidence_unverified");
      if (confidence === "high") confidence = "medium";
    }
    if (["strong", "meets", "partial", "minimal"].includes(rating) && trusted.some(ev => ev.kind === "strength")
      && trusted.filter(ev => ev.kind === "strength").every(ev => ev.starterCode)) {
      confidence = "low";
      warnings.push("credited_starter_code");
    }
    // Not finding something in a snippet of the repo isn't proof it's absent.
    if (rating === "missing" && snapshot.files.length < snapshot.totalFiles && !trusted.length) {
      warnings.push("absence_not_confirmed");
      confidence = "low";
    }

    return {
      ...ri,
      rating,
      ratingLabel: RATINGS[rating].label,
      points: pointsFor(rating, ri.maxPoints),
      confidence,
      summary: str(it.summary),
      evidence,
      improvementTip: str(it.improvementTip),
      probeQuestion: str(it.probeQuestion),
      warnings,
    };
  });

  const scored = items.filter(it => it.points !== null);
  const earned = round1(scored.reduce((s, it) => s + it.points, 0));
  const possible = round1(scored.reduce((s, it) => s + it.maxPoints, 0));
  const percent = possible ? Math.round((earned / possible) * 100) : null;

  return {
    generatedAt: new Date().toISOString(),
    repo: {
      source: snapshot.source,
      name: snapshot.name,
      language: snapshot.language,
      branch: snapshot.branch,
      filesReviewed: snapshot.files.map(f => f.path),
      totalFiles: snapshot.totalFiles,
      signals: snapshot.signals,
      ...(snapshot.changes && { changes: changeCounts(snapshot.changes) }),
    },
    criteria,
    score: {
      earned,
      possible,
      fullRubricPoints: round1(rubric.items.reduce((s, it) => s + it.maxPoints, 0)),
      percent,
      unscoredItems: items.filter(it => it.points === null).map(it => it.id),
      recommendation: recommendationFor(percent),
    },
    items,
    requirements: (Array.isArray(raw.requirements) ? raw.requirements : []).map(r => ({
      requirement: str(r.requirement),
      status: REQUIREMENT_STATUSES.has(r.status) ? r.status : "unclear",
      where: str(r.where),
    })),
    overallSummary: str(raw.overallSummary),
    topStrengths: strList(raw.topStrengths),
    growthAreas: strList(raw.growthAreas),
    redFlags: [...strList(raw.redFlags), ...signalFlags(snapshot)],
  };
}

// Deterministic red flags we can detect without the model.
function signalFlags(snapshot) {
  const flags = [];
  if (snapshot.signals.envCommitted) flags.push("A .env file is committed to the repo. Check whether it contains real secrets (API keys, DB passwords).");
  if (snapshot.signals.nodeModulesCommitted) flags.push("node_modules is committed. Minor for an intern, but worth asking about .gitignore.");
  if (snapshot.changes && hasNoChanges(snapshot.changes)) flags.push("No changes compared to the starter repo: the submission is the unmodified template.");
  return flags;
}

// Marks a "strength" that only points at code the candidate didn't write.
function tagStarterCode(ev, snapshot) {
  const file = snapshot.files.find(f => f.path === ev.file);
  return ev.kind === "strength" && citesOnlyStarterCode(ev, file) ? { ...ev, starterCode: true } : ev;
}

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const str = v => (typeof v === "string" ? v.trim() : "");
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim()) : []);
const round1 = n => Math.round(n * 10) / 10;
