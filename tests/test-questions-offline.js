// test-questions-offline.js
// Checks the question prompt and output normalizing without calling GitHub or the model.
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { buildSectionPrompts, generateInterviewQuestions, normalizeQuestionGuide, planInterview, stackProfile } from "../backend/src/lib/questions.js";
import { extractJson, retryTransient } from "../backend/src/lib/claudeClient.js";
import { planSummary, renderGuideMarkdown } from "../frontend/src/services/guideMarkdown.js";

const repoData = {
  name: "todo-app",
  description: "Assignment: full stack todo list",
  language: "JavaScript",
  topics: ["react", "express"],
  files: [
    { path: "server/routes/todos.js", content: "router.post('/todos', async (req, res) => {})" },
    { path: "package.json", content: '{"dependencies":{"express":"4","pg":"8"},"devDependencies":{"@types/node":"1","jest":"29"}}' },
  ],
};
const resume = readFileSync(new URL("./fixtures/sample-resume.txt", import.meta.url), "utf8");

// Time is allocated in code
const shape = p => [p.sections.assignment.count, p.sections.resume.count, p.sections.backend.count, p.sections.frontend.count, p.sections.problem_solving.dsa, p.sections.problem_solving.sql, p.sections.problem_solving.puzzle];
assert.deepEqual(shape(planInterview(80)), [1, 1, 10, 2, 1, 1, 1]);
assert.equal(planInterview(80).total_questions, 17);
assert.equal(planInterview(80).total_minutes, 80);
assert.deepEqual(planInterview(80).sections.backend, { count: 10, minutes: 40 });
assert.deepEqual(planInterview(80).sections.problem_solving, { count: 3, minutes: 19, dsa: 1, sql: 1, puzzle: 1 });
assert.deepEqual(shape(planInterview(60)), [1, 1, 7, 1, 1, 1, 0]);
assert.equal(planInterview(60).total_minutes, 60);
assert.deepEqual(shape(planInterview(45)), [1, 1, 3, 1, 1, 1, 0]);
assert.equal(planInterview(45).total_minutes, 44);
assert.equal(planInterview(30).minutes, 36);   // clamped to the shortest length that fits
assert.deepEqual(shape(planInterview(30)), [1, 1, 1, 1, 1, 1, 0]);
assert.equal(planInterview(30).total_minutes, 36);
assert.equal(planInterview(500).minutes, 80);
assert.equal(planInterview(undefined).minutes, 80);
assert.equal(planInterview("soon").minutes, 80);
for (let m = 36; m <= 80; m++) {
  const p = planInterview(m);
  assert.ok(p.total_minutes <= m, `plan fits in ${m} minutes`);
  assert.equal(p.sections.problem_solving.count, p.sections.problem_solving.dsa + p.sections.problem_solving.sql + p.sections.problem_solving.puzzle);
}

// Each section gets only the context it needs
const prompts = buildSectionPrompts(repoData, resume, { assignmentBrief: "Build a todo app", interviewMinutes: 80 });
assert.match(prompts.assignment_resume, /Campus Canteen Ordering App/);
assert.match(prompts.assignment_resume, /server\/routes\/todos\.js/);
assert.match(prompts.assignment_resume, /Build a todo app/);
assert.match(prompts.assignment_resume, /exactly 1 assignment question\(s\) and 1 resume/);
assert.match(prompts.backend, /exactly 10 backend fundamentals questions\. This section gets 40 minutes of a 80-minute interview: 10 item\(s\) at 4 minutes each/);
assert.match(prompts.frontend, /exactly 2 frontend/);
assert.match(prompts.problem_solving, /1 DSA, 1 SQL, 1 puzzle/);
assert.match(prompts.problem_solving, /Never copy a problem from LeetCode/);
assert.match(prompts.problem_solving, /Puzzle \(1\)/);
const shortPrompt = buildSectionPrompts(repoData, resume, { interviewMinutes: 60 }).problem_solving;
assert.match(shortPrompt, /1 DSA, 1 SQL and no puzzle/);
assert.doesNotMatch(shortPrompt, /Puzzle \(/);
for (const name of ["backend", "frontend", "problem_solving"]) {
  assert.doesNotMatch(prompts[name], /router\.post|Build a todo app/, `${name} must not see the code or the brief`);
  assert.match(prompts[name], /Test understanding, not recall/);
  assert.match(prompts[name], /Libraries in the repo: express, pg, jest/);
}
assert.match(stackProfile(repoData, "SKILLS\nBackend: Node, Express\nHobbies: chess"), /Databases in the repo: pg\nResume skills: Backend: Node, Express$/);

// Missing resume falls back gracefully
assert.match(buildSectionPrompts(repoData, "").assignment_resume, /No resume provided/);

// The code excerpt stays within its cap
const huge = { ...repoData, files: Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.js`, content: "x\n".repeat(4000) })) };
assert.ok(buildSectionPrompts(huge, "").assignment_resume.length < 32000);

// Sections run side by side and merge in order, held to the plan
const questionsFor = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ question: `Q${i}`, ...extra }));
const problem = (kind, extra = {}) => ({
  question: kind,
  problem: { kind, title: kind, task: "t", examples: [{ input: "1", output: "2", explanation: "e" }, { input: "", output: "0", explanation: "edge" }], schema_sql: "s", expected_output: "o", reference_solution: "r", ...extra },
});
const fullReply = {
  assignment_resume: { candidate_snapshot: { summary: "Snap" }, questions: [{ question: "A", source: { type: "code" } }, { question: "R", source: { type: "resume" } }] },
  backend: { questions: questionsFor(14) },
  frontend: { questions: questionsFor(2) },
  problem_solving: { questions: [problem("puzzle"), problem("sql"), problem("dsa"), problem("sql"), problem("dsa"), problem("dsa")] },
};
const mockLlm = reply => async ({ user }) => {
  const section = user.match(/## Section: (\w+)/)[1];
  if (reply[section] instanceof Error) throw reply[section];
  return JSON.stringify(reply[section]);
};
const full = await generateInterviewQuestions(repoData, resume, { llm: mockLlm(fullReply) });
assert.deepEqual(full.errors, []);
assert.equal(full.questions.length, 17);
assert.deepEqual(full.interview_plan, planInterview(80));
assert.equal(full.questions.reduce((sum, q) => sum + q.time_minutes, 0), 75); // plus 5 for the intro, with extras trimmed
assert.deepEqual(full.questions.slice(-3).map(q => q.time_minutes), [10, 5, 4]);
assert.equal(full.candidate_snapshot.summary, "Snap");
assert.deepEqual(full.questions.slice(0, 2).map(q => q.section), ["assignment", "resume"]);
assert.equal(full.questions.filter(q => q.section === "backend").length, 10); // extras trimmed
assert.deepEqual(full.questions.slice(-3).map(q => q.problem.kind), ["dsa", "sql", "puzzle"]);
for (const m of [36, 45, 60, 80]) {
  const sized = await generateInterviewQuestions(repoData, resume, { interviewMinutes: m, llm: mockLlm(fullReply) });
  assert.ok(5 + sized.questions.reduce((sum, q) => sum + q.time_minutes, 0) <= m, `the guide fits ${m} minutes`);
}

// One section failing keeps the others
const quietWarn = console.warn;
console.warn = () => {};
const partial = await generateInterviewQuestions(repoData, resume, { retryDelayMs: 0, llm: mockLlm({ ...fullReply, backend: new Error("503 boom") }) });
assert.deepEqual(partial.errors, ["Backend questions failed: 503 boom"]);
assert.equal(partial.questions.length, 7);

// Shortfalls and unusable problems are reported, and all sections failing is an error
const short = await generateInterviewQuestions(repoData, resume, {
  llm: mockLlm({ ...fullReply, frontend: { questions: questionsFor(1) }, problem_solving: { questions: [problem("dsa", { examples: [], title: "Thin" }), problem("puzzle")] } }),
});
assert.ok(short.errors.includes("Frontend: got 1 of 2 questions."));
assert.ok(short.errors.includes("Problem solving: got 0 of 1 SQL problems."));
assert.ok(short.errors.includes('Problem "Thin" is missing: worked examples.'));
await assert.rejects(generateInterviewQuestions(repoData, resume, { retryDelayMs: 0, llm: async () => { throw new Error("down"); } }), /down/);

// A failed section gets one more try
let backendCalls = 0;
const recovered = await generateInterviewQuestions(repoData, resume, {
  retryDelayMs: 0,
  llm: async args => {
    if (/## Section: backend/.test(args.user) && ++backendCalls === 1) throw new Error("429");
    return mockLlm(fullReply)(args);
  },
});
assert.equal(backendCalls, 2);
assert.deepEqual(recovered.errors, []);
assert.equal(recovered.questions.length, 17);
console.warn = quietWarn;

// Problem objects get defaults, and non-text answers survive
const normalized = normalizeQuestionGuide({ questions: [{ problem: { kind: "sql", task: "Top buyers", expected_output: [{ name: "Asha" }], examples: ["see above"] } }] }).questions[0];
assert.equal(normalized.section, "problem_solving");
assert.equal(normalized.question, "Top buyers");
assert.equal(normalized.time_minutes, 15);
assert.deepEqual(normalized.problem.hints, []);
assert.equal(normalized.problem.brute_force, "");
assert.match(normalized.problem.expected_output, /Asha/);
assert.equal(normalized.problem.examples[0].explanation, "see above");

// Follow-ups come out as deeper, hint and at most one bonus stretch
const ladder = normalizeQuestionGuide({ questions: [{ question: "Q", follow_ups: [
  { type: "stretch", question: "s1" }, { type: "hint", question: "h1" }, { type: "deeper", question: "d1" }, { type: "deeper", question: "d2" }, { type: "stretch", question: "s2" },
] }] }).questions[0].follow_ups;
assert.deepEqual(ladder.map(f => f.question), ["d1", "h1", "s1"]);
assert.deepEqual(normalizeQuestionGuide({ questions: [{ question: "Q", follow_ups: ["easy", "hard"] }] }).questions[0].follow_ups.map(f => f.type), ["deeper", "hint"]);

// Passing server errors retry with backoff, then give up; other errors don't retry
let attempts = 0;
const waits = [];
const quiet = console.warn;
console.warn = () => {};
assert.equal(await retryTransient(async () => { if (++attempts < 3) throw Object.assign(new Error("x"), { status: 503 }); return "ok"; }, { wait: async ms => waits.push(ms) }), "ok");
assert.deepEqual(waits, [5000, 15000]);
attempts = 0;
await assert.rejects(retryTransient(async () => { attempts++; throw Object.assign(new Error("x"), { status: 503 }); }, { wait: async () => {} }));
assert.equal(attempts, 3);
attempts = 0;
await assert.rejects(retryTransient(async () => { attempts++; throw Object.assign(new Error("x"), { status: 429 }); }, { wait: async () => {} }));
assert.equal(attempts, 1);
console.warn = quiet;

// The download renders sections, problems, answers and the follow-up ladder
const fullWithLadder = { ...full, questions: full.questions.map((q, i) => (i === 2 ? { ...q, follow_ups: [{ type: "stretch", question: "Harder?", model_answer: "Yes", key_points: [] }] } : q)) };
const md = renderGuideMarkdown(fullWithLadder, "todo-app");
assert.match(md, /# Interview guide: todo-app/);
assert.match(planSummary(full), /^80 min plan · Intro 5 · Backend 10 \(40m\) · Frontend 2 \(8m\) · Problem solving 3 \(19m\) · Assignment 1 \(4m\) · Resume 1 \(4m\)$/);
assert.match(md, /## Backend/);
assert.match(md, /80 min plan · Intro 5/);
assert.match(md, /\*\*Bonus: only if time allows:\*\* Harder\?/);
assert.match(md, /### Q17\. puzzle/);
assert.match(md, /\*\*Interviewer notes\*\*/);

// Model output wrapped in fences and prose still parses
const raw = extractJson('Sure!\n```json\n{"questions":[{"question":"What does POST /todos do?","follow_ups":["Why async?"],"red_flag":"Cannot explain"}]}\n```');
const guide = normalizeQuestionGuide(raw);
assert.equal(guide.questions.length, 1);
const q = guide.questions[0];
assert.equal(q.difficulty, "core");
assert.deepEqual(q.red_flags, ["Cannot explain"]);
assert.equal(q.follow_ups[0].question, "Why async?");
assert.equal(q.follow_ups[0].type, "deeper");
assert.deepEqual(guide.candidate_snapshot.resume_claims_to_verify, []);

// Bare arrays (old format) are accepted too
assert.equal(normalizeQuestionGuide([{ question: "Q?" }, { nope: 1 }]).questions.length, 1);

console.log("✅ question generator offline checks passed");
