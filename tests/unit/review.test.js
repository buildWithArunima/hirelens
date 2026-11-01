// Run with: npm test   (no API keys or network needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { normalizeRubric, pointsFor, recommendationFor } from "../../backend/src/lib/rubric.js";
import { extractJson, chatJson } from "../../backend/src/lib/claudeClient.js";
import { parseRepoUrl, fetchRepoSnapshot } from "../../backend/src/lib/githubFetcher.js";
import { verifyEvidence } from "../../backend/src/lib/evidence.js";
import { reviewAssignment } from "../../backend/src/api/analyze.js";
import { buildReviewPrompt } from "../../backend/src/prompts/reviewPrompt.js";
import { renderReportMarkdown } from "../../backend/src/lib/reportMarkdown.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/todo-app", import.meta.url));
const RUBRIC_MD = fileURLToPath(new URL("../../examples/rubric.md", import.meta.url));

test("parses a plain-text rubric with points", async () => {
  const { items } = normalizeRubric(await readFile(RUBRIC_MD, "utf8"));
  assert.equal(items.length, 7);
  assert.deepEqual(items[0], {
    id: "R1",
    criterion: "Functionality",
    description: "All CRUD operations work end to end from the UI.",
    maxPoints: 25,
  });
  assert.equal(items.reduce((s, i) => s + i.maxPoints, 0), 100);
});

test("parses JSON rubrics and defaults missing points", () => {
  const { items } = normalizeRubric('[{"name":"API","points":30},{"criterion":"UI"}]');
  assert.equal(items[0].maxPoints, 30);
  assert.equal(items[1].maxPoints, 10);
  assert.equal(items[1].id, "R2");
});

test("numbered rubric with continuation lines", () => {
  const { items } = normalizeRubric("1. Code quality - 20 points\n   naming and structure\n2) Tests: 10 pts");
  assert.equal(items.length, 2);
  assert.equal(items[0].criterion, "Code quality");
  assert.equal(items[0].maxPoints, 20);
  assert.equal(items[0].description, "naming and structure");
  assert.equal(items[1].maxPoints, 10);
});

test("rating scale and lenient bands", () => {
  assert.equal(pointsFor("meets", 20), 15);
  assert.equal(pointsFor("not_assessable", 20), null);
  assert.equal(recommendationFor(62).key, "advance");
  assert.equal(recommendationFor(44).key, "do_not_advance");
});

test("parses GitHub URLs including /tree/branch/subdir", () => {
  assert.deepEqual(parseRepoUrl("https://github.com/a/b.git"), { owner: "a", repo: "b", branch: null, subPath: null });
  assert.deepEqual(parseRepoUrl("https://github.com/a/b/tree/main/assignment-1/"), { owner: "a", repo: "b", branch: "main", subPath: "assignment-1" });
});

test("extracts JSON from fenced or chatty replies, and repairs once", async () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  let calls = 0;
  const llm = async () => (++calls === 1 ? '{"a":1,}' : '{"a":1}');
  assert.deepEqual(await chatJson({ system: "", user: "", llm }), { a: 1 });
  assert.equal(calls, 2);
});

test("snapshot of a local folder ranks files and finds signals", async () => {
  const snap = await fetchRepoSnapshot(FIXTURE);
  assert.ok(snap.files.some(f => f.path === "server/routes/todos.js"));
  assert.equal(snap.signals.envCommitted, true);
  assert.equal(snap.signals.hasTests, false);
  assert.equal(snap.files[0].path, "README.md");
});

test("evidence verification catches hallucinations and fixes line numbers", async () => {
  const snap = await fetchRepoSnapshot(FIXTURE);
  const ok = verifyEvidence({ file: "server/routes/todos.js", startLine: 11, endLine: 15, quote: 'const { title } = req.body;', kind: "gap" }, snap);
  assert.equal(ok.status, "verified");
  assert.match(ok.snippet, /INSERT INTO todos/);

  const shifted = verifyEvidence({ file: "server/routes/todos.js", startLine: 1, endLine: 2, quote: 'router.delete("/:id"', kind: "strength" }, snap);
  assert.equal(shifted.status, "line_mismatch");
  assert.equal(shifted.startLine, 22);

  assert.equal(verifyEvidence({ file: "server/auth.js", startLine: 1, quote: "jwt.sign" }, snap).status, "file_not_found");
  assert.equal(verifyEvidence({ file: "client/src/App.jsx", startLine: 5, quote: "useReducer(" }, snap).status, "quote_not_found");
  assert.equal(verifyEvidence({ file: null, kind: "gap", note: "No tests" }, snap).status, "absence");
});

test("prompt is line numbered and lists rubric ids", async () => {
  const snap = await fetchRepoSnapshot(FIXTURE);
  const prompt = buildReviewPrompt({ snapshot: snap, criteria: "Build a todo app", rubric: normalizeRubric("- API (10 pts)\n- UI (10 pts)") });
  assert.match(prompt, /\[R2\] UI \(max 10 pts\)/);
  assert.match(prompt, /### FILE: server\/routes\/todos\.js\n 1 \| const express/);
});

test("end to end with a mock model: scores computed in code, bad evidence flagged", async () => {
  const mock = JSON.parse(await readFile(new URL("../fixtures/mock-review.json", import.meta.url), "utf8"));
  const report = await reviewAssignment({
    repo: FIXTURE,
    criteria: "Build a todo app",
    rubric: await readFile(RUBRIC_MD, "utf8"),
    llm: async () => "Here you go:\n```json\n" + JSON.stringify(mock) + "\n```",
  });

  const byId = Object.fromEntries(report.items.map(i => [i.id, i]));
  assert.equal(byId.R1.points, 18.8);         // meets: 25 * 0.75
  assert.equal(byId.R5.points, 2.5);          // minimal: 10 * 0.25
  assert.equal(byId.R4.rating, "meets");      // hallucinated-only evidence...
  assert.equal(byId.R4.confidence, "low");    // ...drops confidence
  assert.ok(byId.R4.warnings.includes("no_verified_evidence"));
  assert.equal(byId.R7.rating, "not_assessable"); // model skipped R7
  assert.equal(byId.R7.points, null);
  assert.equal(report.score.possible, 95);    // R7 excluded from the total
  assert.ok(report.redFlags.some(f => f.includes(".env")));

  const md = renderReportMarkdown(report);
  assert.match(md, /# Assignment review: todo-app/);
  assert.match(md, /\| R1 \| Functionality \| 🟢 Meets intern bar \| 18.8 \/ 25 \| high \|/);
  assert.match(md, /file does not exist in the repo/);
});
