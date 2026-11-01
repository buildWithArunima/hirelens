// backend/src/lib/questions.js
// Generates a guide for an interview of a set length, at most 80 minutes: mostly backend fundamentals,
// then problem solving (DSA, SQL, puzzles), frontend, and a short check of the
// assignment and resume. The mix is computed in code, and each section is its own
// model call with only the context it needs, so one slow or failed call costs one section.

import { chatJson } from "./claudeClient.js";
import { fileChangeTag, hasNoChanges, inRanges, renderChangeSummary } from "./githubFetcher.js";

const MAX_RESUME_CHARS = 8000;
const MAX_CODE_CHARS = 25000;

export const DEFAULT_MINUTES = 80;
export const MAX_MINUTES = 80;
export const MIN_MINUTES = 36; // the shortest length that fits intro plus one question of each required kind

const INTRO_MINUTES = 5;
// Interview time per item, including the main question and one follow-up.
const MINUTES = { assignment: 4, resume: 4, backend: 4, frontend: 4, dsa: 10, sql: 5, puzzle: 4 };
// Each section's share of the time left after the intro.
const SHARES = { assignment: 0.05, resume: 0.05, backend: 0.55, frontend: 0.1, problem_solving: 0.25 };

// Turns an interview length into how many questions of each kind fit in it.
export function planInterview(interviewMinutes = DEFAULT_MINUTES) {
  const minutes = Math.min(Math.max(parseInt(interviewMinutes, 10) || DEFAULT_MINUTES, MIN_MINUTES), MAX_MINUTES);
  const available = minutes - INTRO_MINUTES;
  const countFor = section => Math.max(1, Math.round((available * SHARES[section]) / MINUTES[section]));
  const counts = { assignment: countFor("assignment"), resume: countFor("resume"), backend: countFor("backend"), frontend: countFor("frontend") };

  // DSA and SQL always; a puzzle only if the problem-solving share still has room for one.
  const room = available * SHARES.problem_solving - MINUTES.dsa - MINUTES.sql;
  const kinds = { dsa: 1, sql: 1, puzzle: Math.round(room) >= MINUTES.puzzle ? 1 : 0 };
  const problemMinutes = MINUTES.dsa + MINUTES.sql + kinds.puzzle * MINUTES.puzzle;

  // The minimums above can overshoot a short interview; backend gives way so the length holds.
  const used = () => Object.entries(counts).reduce((sum, [k, n]) => sum + n * MINUTES[k], problemMinutes);
  while (used() > available && counts.backend > 1) counts.backend--;

  const sections = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, { count: n, minutes: n * MINUTES[k] }]));
  sections.problem_solving = { count: kinds.dsa + kinds.sql + kinds.puzzle, minutes: problemMinutes, ...kinds };
  return {
    minutes,
    intro_minutes: INTRO_MINUTES,
    sections,
    total_questions: Object.values(sections).reduce((sum, x) => sum + x.count, 0),
    total_minutes: INTRO_MINUTES + used(),
  };
}

const SYSTEM_PROMPT = `You are a senior full stack engineer who has interviewed hundreds of software interns and now trains first-time interviewers. You write interview guides a nervous new interviewer can run straight from the page: clear questions, what a good answer sounds like, what to listen for, and how to dig deeper. Respond with valid JSON only.`;

const CALIBRATION = `Role: Full Stack Developer Intern, an early interview round. Calibrate to a strong 2nd/3rd-year CS student or fresh graduate who has built a few real projects. Be fair and lenient about vocabulary and polish, but not shallow: we want to know whether they truly understand the fundamentals.

Rules for every question:
- Test understanding, not recall. Ask "why", "how", "what happens if", "what would you change". Never ask a bare definition. Bad: "What is REST?" Good: "Your API returns 200 with {error: 'user not found'} when a user doesn't exist. What's wrong with that, and what should it return instead?"
- Ground each question in a concrete, realistic scenario (food delivery app, college fest ticketing, library system, ride booking, expense tracker...). Vary scenarios; don't reuse one more than twice.
- The interview has a hard time limit, so keep questions short to say and quick to answer. A normal question takes ${MINUTES.backend} minutes in total: a good intern answers the main question in 2-3 minutes, then one follow-up. Each question has exactly 2 follow-ups that count toward the time: "deeper" (why / edge case / what breaks, for a good answer) and "hint" (a gentler angle to rescue a stuck candidate); the interviewer uses one of them. You may add at most 1 optional "stretch" follow-up (a harder twist), which is a bonus used only if time allows.
- No two questions may test the same concept.
- Refer to the candidate as "the candidate" or "they"; never guess gender.
- For every question and follow-up give: model_answer (2-4 sentences, written so a new interviewer learns the topic from it) and key_points (3-4 things to listen for). For main questions also give pass_bar (one sentence: the minimum good-intern answer), red_flags (real concerns for an intern, not normal gaps), common_wrong_answers (1-3 typical misconceptions), and difficulty ("warm-up" | "core" | "stretch"; about 30% / 50% / 20%).`;

const QUESTION_SHAPE = `{
  "section": "SECTION",
  "category": "Short topic, e.g. HTTP",
  "difficulty": "warm-up | core | stretch",
  "source": { "type": "code | resume | fundamentals | problem", "reference": "file and function, resume claim, or topic" },
  "question": "The main question, phrased for the candidate",
  "why": "What this tells the interviewer",
  "model_answer": "...",
  "key_points": ["..."],
  "pass_bar": "...",
  "red_flags": ["..."],
  "common_wrong_answers": ["..."],
  "follow_ups": [
    { "type": "deeper", "question": "...", "model_answer": "...", "key_points": ["..."] },
    { "type": "hint", "question": "...", "model_answer": "...", "key_points": ["..."] },
    { "type": "stretch", "question": "Optional bonus; leave this one out if nothing fits", "model_answer": "...", "key_points": ["..."] }
  ]PROBLEM
}`;

const PROBLEM_SHAPE = `,
  "problem": {
    "kind": "dsa | sql | puzzle",
    "title": "...",
    "scenario": "...",
    "task": "...",
    "input_format": "...",
    "output_format": "...",
    "constraints": ["..."],
    "examples": [{ "input": "...", "output": "...", "explanation": "..." }],
    "clarifications": ["..."],
    "schema_sql": "SQL only: CREATE TABLE statements",
    "sample_data": "SQL only: INSERT statements",
    "expected_output": "SQL only: the result table for that sample data",
    "pattern": "...",
    "brute_force": "...",
    "optimal_approach": "...",
    "complexity": "...",
    "reference_solution": "...",
    "edge_cases": ["..."],
    "hints": ["gentle", "medium", "strong"],
    "common_mistakes": ["..."]
  }`;

const shape = (section, problem = false) => QUESTION_SHAPE.replace("SECTION", section).replace("PROBLEM", problem ? PROBLEM_SHAPE : "");

// With a starter to compare against, a "+" margin marks the lines the candidate wrote.
function markChangedLines(file) {
  if (!file.change) return file.content;
  return file.content.split("\n").map((l, i) => `${inRanges(file.changedLines || [], i + 1) ? "+ " : "  "}${l}`).join("\n");
}

function renderChanges(changes) {
  if (!changes) return "";
  const nothing = hasNoChanges(changes)
    ? `\nThe candidate changed nothing, so no assignment work exists to ask about.\n`
    : "";
  return `
## Candidate's Changes vs the Starter
${renderChangeSummary(changes)}
${nothing}
Rules for this guide:
- This diff is the only proof of what the candidate did. Lines marked "+" and files tagged [added by the candidate] are their work.
- Only say "you" or "your" about code they changed. For unchanged starter code, phrase it as "the starter code does X; how would you...".
- Never assume a task was done unless the diff shows it: no "how did you fix X" when X is unchanged.
- The candidate_snapshot summary must not claim work the diff doesn't show.
`;
}

// The candidate's changed files (or the top files when there's no starter), within the size cap.
function codeExcerpt(repoData) {
  const changed = repoData.files.filter(f => f.change && f.change !== "unchanged");
  const out = [];
  let left = MAX_CODE_CHARS;
  for (const f of changed.length ? changed : repoData.files) {
    if (left <= 0) break;
    const body = markChangedLines(f);
    const kept = body.length > left ? body.slice(0, body.lastIndexOf("\n", left) + 1 || left) : body;
    out.push(`### File: ${f.path}${fileChangeTag(f)}${kept.length < body.length ? " (cut short)" : ""}\n\`\`\`\n${kept}\n\`\`\``);
    left -= kept.length;
  }
  return out.join("\n\n");
}

const DB_PACKAGES = /^(pg|mysql2?|mongoose|mongodb|prisma|@prisma\/client|sqlite3|better-sqlite3|sequelize|typeorm|drizzle-orm|redis|ioredis|knex)$/;

// A few lines on the stack, for sections that don't need to see any code.
export function stackProfile(repoData, resumeText = "") {
  const deps = new Set();
  for (const f of repoData.files || []) {
    if (!/(^|\/)package\.json$/.test(f.path)) continue;
    try {
      const pkg = JSON.parse(f.content);
      Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(d => !d.startsWith("@types/")).forEach(d => deps.add(d));
    } catch { /* cut short or malformed: go on without it */ }
  }
  const databases = [...deps].filter(d => DB_PACKAGES.test(d));
  const skills = resumeText.split("\n").map(l => l.trim()).filter(l => /^(skills|languages|frontend|backend|databases?|tools)\b.*:/i.test(l)).slice(0, 5);
  return [
    `Language: ${repoData.language || "unknown"}`,
    `Libraries in the repo: ${[...deps].slice(0, 25).join(", ") || "none detected"}`,
    `Databases in the repo: ${databases.join(", ") || "none detected"}`,
    `Resume skills: ${skills.join("; ") || "not given"}`,
  ].join("\n");
}

// One prompt per model call. `questions` returned by the section go through normalizeQuestionGuide.
export function buildSectionPrompts(repoData, resumeText, options = {}) {
  const { assignmentBrief = "", interviewMinutes } = options;
  const plan = options.plan || planInterview(interviewMinutes);
  const { assignment, resume: resumeSection, backend, frontend, problem_solving: problems } = plan.sections;
  const budget = (section, n, each) => `This section gets ${section} minutes of a ${plan.minutes}-minute interview: ${n} item(s) at ${each} minutes each, follow-up included.`;
  const resume = (resumeText || "").trim().slice(0, MAX_RESUME_CHARS);
  const stack = stackProfile(repoData, resume);
  const section = (name, body, output) => `## Section: ${name}

${CALIBRATION}

${body}

## Output format (strict JSON)
Return ONLY a JSON object, no markdown, no explanation outside JSON:
${output}`;
  const list = (name, problem) => `{ "questions": [ ${shape(name, problem)} ] }`;

  return {
    assignment_resume: section("assignment_resume", `Write exactly ${assignment.count} assignment question(s) and ${resumeSection.count} resume question(s). ${budget(assignment.minutes + resumeSection.minutes, assignment.count + resumeSection.count, MINUTES.assignment)}

Assignment questions exist only to confirm the candidate actually built the submission and understands it. Pick specific changes the candidate made (use the change list; cite file and function/component in source.reference) and ask them to walk through their reasoning, a trade-off, or what they'd change. Only say "you/your" about code the candidate changed. If the diff shows the candidate changed nothing, say so in the question's "why" and instead ask how they would approach one of the assignment tasks.

Resume questions: pick the most impressive or most specific claim (a metric, a feature, a technology) and ask how they personally built it, at a depth that separates real involvement from a copied bullet point. Never assume work the resume or diff doesn't show. If no resume is given, ask about the project they are proudest of.

## Candidate Resume
${resume || "(No resume provided.)"}

## Assignment Brief
${assignmentBrief.trim() || "(Not provided. Infer the intent from the code and README.)"}

## Assignment Repository: ${repoData.name}
${renderChanges(repoData.changes)}
${codeExcerpt(repoData)}`, `{
  "candidate_snapshot": {
    "summary": "2-3 sentences on the candidate's background and the assignment. Must not claim work the diff or resume doesn't show. Write "the candidate" or "they", never "she" or "he".",
    "strengths_to_probe": ["..."],
    "resume_claims_to_verify": ["..."]
  },
  "questions": [ ${shape("assignment | resume")} ]
}`),

    backend: section("backend", `Write exactly ${backend.count} backend fundamentals questions. ${budget(backend.minutes, backend.count, MINUTES.backend)} This is the most important section of the interview. Cover as many distinct areas as the count allows, prioritising in this order: HTTP (methods, status codes, idempotency, headers); REST API design (resource naming, pagination, versioning, error responses); Node.js runtime (event loop, blocking vs non-blocking, async/await and promise errors); Express (middleware order, routing, centralised error handling, request validation); databases (SQL vs NoSQL choice, primary/foreign keys, joins, indexes and when they hurt, normalisation, transactions and ACID); authentication and authorisation (sessions vs JWT, password hashing, where to store tokens); web security basics (SQL injection, XSS, CORS, secrets in env vars, rate limiting); caching basics (what, where, invalidation); debugging a slow or failing API.

Prefer the candidate's stack for examples, but the concepts must be general. Questions should feel like real situations a junior backend dev hits in their first month.

## Candidate's stack
${stack}`, list("backend")),

    frontend: section("frontend", `Write exactly ${frontend.count} frontend fundamentals questions. ${budget(frontend.minutes, frontend.count, MINUTES.frontend)} Pick the most important concepts from: how React decides to re-render (state, props, keys); useEffect dependencies and cleanup; controlled vs uncontrolled inputs; fetching data with loading, error and empty states; lifting state vs context; CSS layout (flexbox/grid) and responsive design; browser basics (event bubbling, what happens when you type a URL). Use the candidate's stack where natural.

## Candidate's stack
${stack}`, list("frontend")),

    problem_solving: section("problem_solving", `Write exactly ${problems.count} problem-solving questions to run live in the interview: ${problems.dsa} DSA, ${problems.sql} SQL${problems.puzzle ? `, ${problems.puzzle} puzzle` : " and no puzzle"}. This section gets ${problems.minutes} minutes of a ${plan.minutes}-minute interview. Each item has a "problem" object as well as the usual fields. Put the problem's one-line ask in "question".

DSA (${problems.dsa}):
- Never copy a problem from LeetCode, HackerRank, GeeksforGeeks, Codeforces or similar, verbatim or with only renamed nouns. Start from a classic pattern (hashing, two pointers, sliding window, stack, prefix sums, binary search, intervals, BFS/DFS, greedy, simple DP) and build a fresh real-world scenario that changes at least one rule (an extra constraint, a different output, a twist) so a memorised solution doesn't fit as is.
- Intern level, and small: a good intern solves it in about ${MINUTES.dsa} minutes of discussion plus coding, so pick a smaller problem with one clear optimal idea. Brute force is an acceptable start, an O(n) or O(n log n) idea is the goal.
- The statement must be complete and unambiguous: scenario, task, input format, output format, constraints (sizes, value ranges), 2 worked examples including one edge case, each with an explanation, and clarifications (duplicates? empty input? ties? sorted?).
- For the interviewer: the underlying pattern, brute force idea and complexity, optimal approach step by step and its complexity, a reference solution in JavaScript, edge cases to test, 3 hints from gentle to strong, and follow-ups (larger input, streaming data, return k results, etc.).

SQL (${problems.sql}):
- One query, solvable in about ${MINUTES.sql} minutes. Give a small schema of 2 related tables as CREATE TABLE statements, 4-6 sample rows per table as INSERT statements, the question in plain business language, the expected result table for that sample data (work it out row by row so it is exactly right), a reference query (PostgreSQL) in reference_solution, what it tests in pattern (JOIN type, GROUP BY/HAVING, NULL handling, subquery; window functions only as stretch), common mistakes (e.g. INNER JOIN dropping rows, COUNT(*) vs COUNT(col)), and follow-ups (an index to speed it up, a changed requirement).

${problems.puzzle ? `Puzzle (${problems.puzzle}):
- Short: about ${MINUTES.puzzle} minutes in the interview. Logic, estimation or reasoning puzzles that reward structured thinking out loud, not trick riddles or one-"aha" lateral puzzles. Avoid famous puzzles as is (25 horses, burning ropes, 100 prisoners, egg drop...); if inspired by one, change the setup and numbers. Give the full problem, the answer in reference_solution, the step-by-step reasoning in optimal_approach, and what good thinking aloud sounds like in model_answer even if they don't finish.
` : ""}

Fields not relevant to a kind may be empty strings or arrays. Use source.type "problem".

## Candidate's stack (for picking the solution language)
${stack}`, list("problem_solving", true)),
  };
}

const SECTION_CALLS = [
  { name: "assignment_resume", label: "Assignment and resume", tokens: ({ sections: s }) => (s.assignment.count + s.resume.count) * 2000 },
  { name: "backend", label: "Backend", tokens: ({ sections: s }) => s.backend.count * 2000 },
  { name: "frontend", label: "Frontend", tokens: ({ sections: s }) => s.frontend.count * 2000 },
  { name: "problem_solving", label: "Problem solving", tokens: ({ sections: s }) => s.problem_solving.count * 4000 },
];
const SECTION_ORDER = ["assignment", "resume", "backend", "frontend", "problem_solving"];
const SECTION_LABEL = { assignment: "Assignment", resume: "Resume", backend: "Backend", frontend: "Frontend", problem_solving: "Problem solving" };
const KIND_LABEL = { dsa: "DSA", sql: "SQL", puzzle: "puzzle" };
const SECTION_RETRY_DELAY_MS = 30_000; // free tiers limit requests per minute, and the calls above all start together

export async function generateInterviewQuestions(repoData, resumeText, options = {}) {
  const plan = planInterview(options.interviewMinutes);
  const prompts = buildSectionPrompts(repoData, resumeText, { ...options, plan });
  const callSection = s => chatJson({
    system: SYSTEM_PROMPT,
    user: prompts[s.name],
    maxTokens: Math.max(8000, s.tokens(plan)),
    ...(options.llm && { llm: options.llm }),
  });
  const results = await Promise.allSettled(SECTION_CALLS.map(callSection));

  // Give failed sections one more go, one at a time, once the burst has passed.
  for (const [i, s] of SECTION_CALLS.entries()) {
    if (results[i].status === "fulfilled") continue;
    console.warn(`${s.label} questions failed (${results[i].reason.message}); trying once more shortly`);
    await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? SECTION_RETRY_DELAY_MS));
    [results[i]] = await Promise.allSettled([callSection(s)]);
  }
  if (results.every(r => r.status === "rejected")) throw results[0].reason;
  return mergeSections(results, plan);
}

function mergeSections(results, plan) {
  const errors = [];
  const bySection = Object.fromEntries(SECTION_ORDER.map(s => [s, []]));
  let snapshot;

  results.forEach((r, i) => {
    const call = SECTION_CALLS[i];
    if (r.status === "rejected") {
      console.error(`${call.label} questions failed:`, r.reason);
      errors.push(`${call.label} questions failed: ${r.reason.message}`);
      return;
    }
    const guide = normalizeQuestionGuide(r.value, call.name === "assignment_resume" ? "assignment" : call.name);
    if (call.name === "assignment_resume") snapshot = guide.candidate_snapshot;
    guide.questions.forEach(q => {
      if (call.name !== "assignment_resume") q.section = call.name;
      else if (q.section !== "resume") q.section = "assignment";
      // The plan's times, not the model's, are what keep the interview within its cap.
      q.time_minutes = MINUTES[q.problem?.kind] || MINUTES[q.section] || q.time_minutes;
      bySection[q.section].push(q);
    });
  });

  // Hold every section to the plan: extra questions go, shortfalls get reported.
  bySection.problem_solving = pickProblems(bySection.problem_solving, plan, errors);
  const failed = i => results[i].status === "rejected";
  const check = (section, callIndex) => {
    const { count } = plan.sections[section];
    bySection[section] = bySection[section].slice(0, count);
    if (!failed(callIndex) && bySection[section].length < count) {
      errors.push(`${SECTION_LABEL[section]}: got ${bySection[section].length} of ${count} questions.`);
    }
  };
  check("assignment", 0);
  check("resume", 0);
  check("backend", 1);
  check("frontend", 2);
  if (!failed(3)) errors.push(...problemGaps(bySection.problem_solving));

  return {
    candidate_snapshot: snapshot || normalizeQuestionGuide({}).candidate_snapshot,
    interview_plan: plan,
    questions: SECTION_ORDER.flatMap(s => bySection[s]),
    errors,
  };
}

// DSA first, then SQL, then puzzles, each up to its planned count.
function pickProblems(questions, plan, errors) {
  const picked = [];
  let shortBy = 0;
  for (const kind of ["dsa", "sql", "puzzle"]) {
    const ofKind = questions.filter(q => q.problem?.kind === kind);
    const wanted = plan.sections.problem_solving[kind];
    picked.push(...ofKind.slice(0, wanted));
    if (questions.length && ofKind.length < wanted) {
      errors.push(`Problem solving: got ${ofKind.length} of ${wanted} ${KIND_LABEL[kind]} problems.`);
      shortBy += wanted - ofKind.length;
    }
  }
  // Anything the model didn't label can still fill a gap.
  picked.push(...questions.filter(q => !KIND_LABEL[q.problem?.kind]).slice(0, shortBy));
  return picked;
}

// A problem an interviewer can't run from the page is worth saying out loud.
function problemGaps(questions) {
  const gaps = [];
  for (const { problem: p } of questions) {
    if (!p) continue;
    const missing = [];
    if (p.kind === "dsa") {
      if (!p.task) missing.push("task");
      if (p.examples.length < 2) missing.push("worked examples");
      if (!p.reference_solution) missing.push("reference solution");
    }
    if (p.kind === "sql") {
      if (!p.schema_sql) missing.push("schema");
      if (!p.expected_output) missing.push("expected output");
      if (!p.reference_solution) missing.push("reference query");
    }
    if (missing.length) gaps.push(`Problem "${p.title || "untitled"}" is missing: ${missing.join(", ")}.`);
  }
  return gaps;
}

const asList = v => (Array.isArray(v) ? v : v ? [v] : []);
// Models sometimes send a table or object where we asked for text.
const asText = v => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

function normalizeProblem(p) {
  const texts = ["title", "scenario", "task", "input_format", "output_format", "schema_sql", "sample_data", "expected_output", "pattern", "brute_force", "optimal_approach", "complexity", "reference_solution"];
  const lists = ["constraints", "clarifications", "edge_cases", "hints", "common_mistakes"];
  return {
    kind: p.kind || "",
    ...Object.fromEntries(texts.map(k => [k, asText(p[k])])),
    ...Object.fromEntries(lists.map(k => [k, asList(p[k]).map(asText)])),
    examples: asList(p.examples).map(e => (typeof e === "object" ? { input: asText(e.input), output: asText(e.output), explanation: asText(e.explanation) } : { input: "", output: "", explanation: asText(e) })),
  };
}

// One "deeper" and one "hint" count toward the time; one "stretch" is an optional bonus.
const followUpLadder = followUps =>
  ["deeper", "hint", "stretch"].map(type => followUps.find(f => f.type === type)).filter(Boolean);

function inferSection(q, fallback) {
  if (SECTION_ORDER.includes(q.section)) return q.section;
  if (q.problem || q.source?.type === "problem") return "problem_solving";
  if (q.source?.type === "resume") return "resume";
  if (q.source?.type === "code") return "assignment";
  return fallback;
}

// Fills in missing fields so the UI never has to guard against partial output.
export function normalizeQuestionGuide(raw, defaultSection = "backend") {
  const guide = Array.isArray(raw) ? { questions: raw } : raw || {};
  const snapshot = guide.candidate_snapshot || {};

  const normalizeFollowUp = (f, i) =>
    typeof f === "string"
      ? { type: i === 0 ? "deeper" : "hint", question: f, model_answer: "", key_points: [] }
      : {
          type: f.type || (i === 0 ? "deeper" : "hint"),
          question: f.question || "",
          model_answer: f.model_answer || "",
          key_points: asList(f.key_points),
        };

  return {
    candidate_snapshot: {
      summary: snapshot.summary || "",
      strengths_to_probe: asList(snapshot.strengths_to_probe),
      resume_claims_to_verify: asList(snapshot.resume_claims_to_verify),
    },
    interview_plan: guide.interview_plan || null,
    errors: asList(guide.errors),
    questions: asList(guide.questions)
      .filter(q => q && (q.question || q.problem))
      .map(q => ({
        section: inferSection(q, defaultSection),
        category: q.category || "General",
        difficulty: q.difficulty || "core",
        time_minutes: Number(q.time_minutes) || (q.problem ? 15 : 4),
        source: {
          type: q.source?.type || "fundamentals",
          reference: q.source?.reference || "",
        },
        question: q.question || q.problem?.task || q.problem?.title || "",
        why: q.why || "",
        model_answer: q.model_answer || "",
        key_points: asList(q.key_points),
        pass_bar: q.pass_bar || "",
        red_flags: asList(q.red_flags || q.red_flag),
        common_wrong_answers: asList(q.common_wrong_answers),
        follow_ups: followUpLadder(asList(q.follow_ups || q.follow_up).map(normalizeFollowUp)),
        ...(q.problem && { problem: normalizeProblem(q.problem) }),
      })),
  };
}
