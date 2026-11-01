// backend/src/lib/reportMarkdown.js
// Renders a review report as Markdown an interviewer can read before the call.

const RATING_ICON = { strong: "🟢", meets: "🟢", partial: "🟡", minimal: "🟠", missing: "🔴", not_assessable: "⚪" };
const REQ_ICON = { met: "✅", partial: "🟡", not_met: "❌", unclear: "❔" };
const EVIDENCE_NOTE = {
  verified: "",
  absence: "",
  line_mismatch: " _(line numbers corrected)_",
  quote_not_found: " ⚠️ _quote not found in file, check manually_",
  file_not_found: " ⚠️ _file does not exist in the repo, ignore this_",
  file_not_fetched: " ⚠️ _file exists but was not reviewed_",
  lines_only: " _(no quote given)_",
  file_only: " _(no lines given)_",
  unverified: " ⚠️ _unverified_",
};
const WARNING_TEXT = {
  no_verified_evidence: "No verified code evidence backs this rating. Check it yourself.",
  some_evidence_unverified: "Some cited evidence could not be found in the code.",
  absence_not_confirmed: "Rated as not found, but only part of the repo was reviewed.",
  missing_from_model_output: "The reviewer skipped this item.",
  credited_starter_code: "This rating only cites code from the starter repo, not the candidate's changes. Check it yourself.",
};

export function renderReportMarkdown(report) {
  const out = [];
  const { score, repo } = report;
  const ext = p => (p.match(/\.(\w+)$/)?.[1] || "").replace(/^(mjs|cjs)$/, "js");

  out.push(`# Assignment review: ${repo.name}`);
  out.push("");
  out.push(`**Score:** ${score.earned} / ${score.possible}${score.percent !== null ? ` (${score.percent}%)` : ""} · **Recommendation:** ${score.recommendation.label}`);
  if (score.unscoredItems.length) {
    out.push("");
    out.push(`_${score.unscoredItems.length} rubric item(s) could not be assessed from the code and are left out of the total (full rubric is ${score.fullRubricPoints} pts). Check them in the interview._`);
  }
  out.push("");
  out.push(`Repo: ${repo.source}${repo.branch ? ` (branch \`${repo.branch}\`)` : ""} · Reviewed ${repo.filesReviewed.length} of ${repo.totalFiles} files · Graded against an intern-level bar`);
  if (repo.changes) {
    const c = repo.changes;
    out.push("", `Compared with the starter ${c.starter}: ${c.added} file(s) added, ${c.modified} modified, ${c.deleted} deleted, ${c.unchanged} unchanged. Only the candidate's changes earn credit.`);
  }
  out.push("");

  if (report.overallSummary) out.push("## Summary", "", report.overallSummary, "");

  if (report.redFlags.length) {
    out.push("## ⚠️ Red flags", "");
    report.redFlags.forEach(f => out.push(`- ${f}`));
    out.push("");
  }

  out.push("## Scorecard", "", "| # | Rubric item | Rating | Points | Confidence |", "|---|---|---|---|---|");
  for (const it of report.items) {
    out.push(`| ${it.id} | ${esc(it.criterion)} | ${RATING_ICON[it.rating]} ${it.ratingLabel} | ${it.points ?? "–"} / ${it.maxPoints} | ${it.confidence} |`);
  }
  out.push("");

  if (report.requirements.length) {
    out.push("## Requirements checklist", "");
    report.requirements.forEach(r => out.push(`- ${REQ_ICON[r.status]} ${r.requirement}${r.where ? ` _(${r.where})_` : ""}`));
    out.push("");
  }

  if (report.topStrengths.length || report.growthAreas.length) {
    out.push("## Strengths and growth areas", "");
    if (report.topStrengths.length) {
      out.push("**Strengths**", "");
      report.topStrengths.forEach(s => out.push(`- ${s}`));
      out.push("");
    }
    if (report.growthAreas.length) {
      out.push("**Growth areas (coach, don't penalize)**", "");
      report.growthAreas.forEach(s => out.push(`- ${s}`));
      out.push("");
    }
  }

  out.push("## Detailed review", "");
  for (const it of report.items) {
    out.push(`### ${it.id}. ${it.criterion}: ${RATING_ICON[it.rating]} ${it.ratingLabel} (${it.points ?? "–"} / ${it.maxPoints})`);
    out.push("");
    if (it.description) out.push(`> ${it.description}`, "");
    if (it.summary) out.push(it.summary, "");
    it.warnings.forEach(w => out.push(`> ⚠️ ${WARNING_TEXT[w] || w}`, ""));

    for (const ev of it.evidence) {
      const label = ev.kind === "gap" ? "Gap" : "Strength";
      const loc = ev.file ? `\`${ev.file}${ev.startLine ? `:${ev.startLine}${ev.endLine && ev.endLine !== ev.startLine ? `-${ev.endLine}` : ""}` : ""}\`` : "_repo-wide_";
      out.push(`- **${label}** ${loc}: ${ev.note}${EVIDENCE_NOTE[ev.status] ?? ""}${ev.starterCode ? " ⚠️ _starter code, not the candidate's_" : ""}`);
      if (ev.snippet) {
        out.push("", "  ```" + ext(ev.file));
        ev.snippet.split("\n").forEach(l => out.push("  " + l));
        out.push("  ```", "");
      }
    }
    if (it.improvementTip) out.push("", `**Tip for the candidate:** ${it.improvementTip}`);
    if (it.probeQuestion) out.push("", `**Ask in the interview:** ${it.probeQuestion}`);
    out.push("");
  }

  out.push("---", `_Files reviewed: ${repo.filesReviewed.map(f => `\`${f}\``).join(", ")}_`);
  return out.join("\n") + "\n";
}

const esc = s => String(s).replace(/\|/g, "\\|");
