// backend/src/prompts/reviewPrompt.js
// Prompt for the rubric-based assignment review. The model rates each rubric
// item and cites file + line evidence; points and totals are computed in code.

import { RATINGS } from "../lib/rubric.js";
import { fileChangeTag, hasNoChanges, inRanges, renderChangeSummary } from "../lib/githubFetcher.js";

export const REVIEW_SYSTEM_PROMPT = `You are a kind but honest senior full-stack engineer helping a NEW interviewer review a take-home assignment from an INTERN candidate. This is one of the first interview rounds.

How to judge:
- The bar is "a good intern", not a senior engineer. A working main flow with a reasonable approach MEETS the bar.
- Be lenient on polish, production concerns (scaling, caching, CI, Docker), and style nitpicks. Mention them as growth areas, never as reasons to fail an item.
- Be strict only about evidence: every rating must be grounded in code you can see. Never invent files, functions or behaviour.
- If the relevant code was not provided (e.g. a file is listed in the tree but its content was not fetched), use "not_assessable" instead of guessing.
- Credit partial work. Prefer "partial" over "missing" when there is a real attempt.
- If the criteria say the candidate worked on an existing or starter app, rate only what they changed. Pre-existing code earns no credit; use the commit history and the criteria to tell the two apart, and lower your confidence when you can't.
- Write for a new interviewer: plain language, concrete, and point at exactly where to look.
- Say "the candidate" or "they". Never guess gender from a name.

Respond with valid JSON only. No markdown fences, no text outside the JSON.`;

// With a starter to compare against, a "+" margin marks the lines the candidate wrote.
function numberLines(file) {
  const lines = file.content.replace(/\n$/, "").split("\n");
  const width = String(lines.length).length;
  const margin = i => (!file.change ? "" : inRanges(file.changedLines || [], i + 1) ? "+ " : "  ");
  return lines.map((l, i) => `${margin(i)}${String(i + 1).padStart(width)} | ${l}`).join("\n");
}

// Tells the model what the candidate actually did, when a starter repo was given.
function renderChanges(changes) {
  if (!changes) return "";
  const nothing = hasNoChanges(changes)
    ? `\nThe candidate changed nothing, so rate every rubric item "missing" and say the submission is the unmodified template.\n`
    : "";
  return `
## Candidate's changes vs starter
${renderChangeSummary(changes)}
${nothing}
Rules for this review:
- Only credit code the candidate added or changed: files tagged [added by the candidate] and lines marked "+" in the listing below (and starter lines they removed, listed above, when removing them was the fix).
- Starter code earns nothing, however good it is. Cite it only as a gap ("still has the starter's bug"), never as a strength.
- Never describe starter code as the candidate's work. Do not assume a task was done unless the changes show it.
- Commits tagged (starter) came with the template and say nothing about the candidate's Git habits.
`;
}

function renderRubric(rubric) {
  return rubric.items
    .map(it => `- [${it.id}] ${it.criterion} (max ${it.maxPoints} pts)${it.description ? `: ${it.description}` : ""}`)
    .join("\n");
}

export function buildReviewPrompt({ snapshot, criteria, rubric }) {
  const fetched = new Set(snapshot.files.map(f => f.path));
  const tree = snapshot.tree.map(p => (fetched.has(p) ? `${p}  [content below]` : p)).join("\n");

  const files = snapshot.files
    .map(f => `### FILE: ${f.path}${fileChangeTag(f)}${f.truncated ? ` (truncated: showing first part of ${f.totalLines} lines)` : ""}\n${numberLines(f)}`)
    .join("\n\n");

  const commits = snapshot.commits.length
    ? snapshot.commits.map(c => `- ${c.date ? c.date.slice(0, 10) : ""} ${c.message}${c.fromStarter ? " (starter)" : ""}`).join("\n")
    : "(not available)";

  const scale = Object.entries(RATINGS).map(([k, v]) => `- "${k}": ${v.meaning}`).join("\n");

  return `## Assignment criteria (what the candidate was asked to build)
${criteria?.trim() || "(No separate criteria given. Infer the requirements from the rubric.)"}

## Rubric
${renderRubric(rubric)}
${renderChanges(snapshot.changes)}
## Rating scale (pick one per rubric item)
${scale}

## Repository: ${snapshot.name}
Description: ${snapshot.description || "N/A"}
Primary language: ${snapshot.language || "unknown"}
Total files: ${snapshot.totalFiles}. Files marked [content below] were fetched; others you can only see by name.
Signals: ${JSON.stringify(snapshot.signals)}

### File tree${snapshot.treeTruncated ? " (truncated)" : ""}
${tree}

### Recent commits
${commits}

## Source code (line numbered as "N | code"${snapshot.changes ? `, with "+ N | code" on lines the candidate wrote` : ""})
${files}

## Your task
1. For EVERY rubric item above (use its id), choose a rating, explain it in 1-3 sentences, and cite 1-4 pieces of evidence.
   Each evidence entry must point at a fetched file and real line numbers, and "quote" must be copied exactly from a single line of that range (without the "N | " or "+ N | " prefix).
   Use kind "strength" for something done well and "gap" for something missing or wrong. For a gap that is "nothing exists", cite the closest relevant file or use file null.
2. Check each requirement in the assignment criteria and mark it met / partial / not_met / unclear.
3. Give overall strengths and growth areas at the intern level, and list red flags ONLY for serious issues (committed secrets, copied code that the candidate likely can't explain, the app clearly does not run, the core requirement is missing).
4. For each rubric item, suggest one short thing the interviewer should ask the candidate to verify understanding of that code.

Return exactly this JSON shape:
{
  "items": [
    {
      "rubricId": "R1",
      "rating": "meets",
      "confidence": "high | medium | low",
      "summary": "Why this rating, in plain language.",
      "evidence": [
        { "file": "path/to/file.js", "startLine": 10, "endLine": 18, "quote": "exact text from one line", "kind": "strength | gap", "note": "What this shows." }
      ],
      "improvementTip": "One concrete, encouraging suggestion.",
      "probeQuestion": "A question to ask about this code in the interview."
    }
  ],
  "requirements": [
    { "requirement": "short restatement", "status": "met | partial | not_met | unclear", "where": "file(s) or why unclear" }
  ],
  "overallSummary": "3-5 sentences a new interviewer can read before the call.",
  "topStrengths": ["..."],
  "growthAreas": ["..."],
  "redFlags": ["..."]
}`;
}
