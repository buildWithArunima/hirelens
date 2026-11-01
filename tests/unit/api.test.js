// Run with: npm test   (no API keys or network needed)
// Exercises the HTTP API the web UI calls, with a local repo and a mock model.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../backend/app.js";
import { classifyChanges, diffLines, fetchRepoSnapshot } from "../../backend/src/lib/githubFetcher.js";
import { buildReport } from "../../backend/src/api/analyze.js";
import { buildReviewPrompt } from "../../backend/src/prompts/reviewPrompt.js";
import { buildSectionPrompts } from "../../backend/src/lib/questions.js";
import { normalizeRubric } from "../../backend/src/lib/rubric.js";
import { verifyEvidence } from "../../backend/src/lib/evidence.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/todo-app", import.meta.url));
const read = p => readFile(new URL(p, import.meta.url), "utf8");
const QUESTIONS = { questions: [{ question: "Walk me through POST /todos.", follow_ups: ["Why 201?"] }] };

let server, base, mockReview;
const llm = async ({ system }) => (/first-time interviewers/.test(system) ? JSON.stringify(QUESTIONS) : JSON.stringify(mockReview));

before(async () => {
  mockReview = JSON.parse(await read("../fixtures/mock-review.json"));
  const app = createApp({ llm, fetchSnapshot: () => fetchRepoSnapshot(FIXTURE) });
  await new Promise(resolve => (server = app.listen(0, resolve)));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async res => ({ status: res.status, body: await res.json() }));

test("POST /api/analyze returns the review and the question guide together", async () => {
  const { status, body } = await post("/api/analyze", {
    repoUrl: "https://github.com/someone/todo-app",
    criteria: await read("../../examples/criteria.md"),
    rubric: await read("../../examples/rubric.md"),
    resume: await read("../fixtures/sample-resume.txt"),
  });
  assert.equal(status, 200);
  assert.deepEqual(body.errors, {});
  assert.equal(body.repo.name, "todo-app");
  assert.equal(body.review.report.items.length, 7);
  assert.match(body.review.markdown, /todo-app/);
  assert.equal(body.questions.questions[0].follow_ups[0].question, "Why 201?");
});

test("POST /api/analyze without a rubric skips the review", async () => {
  const { body } = await post("/api/analyze", { repoUrl: "https://github.com/someone/todo-app" });
  assert.equal(body.review, null);
  assert.equal(body.questions.interview_plan.minutes, 80);
  assert.equal(body.questions.questions.length, 4); // one reply per section from the mock
});

test("rejects non-GitHub sources so the web API can't read server folders", async () => {
  for (const repoUrl of ["/etc", "../secrets", "https://example.com/github.com/a/b", undefined]) {
    const { status } = await post("/api/analyze", { repoUrl });
    assert.equal(status, 400);
  }
});

test("POST /api/review still works on its own", async () => {
  const { status, body } = await post("/api/review", {
    repoUrl: "https://github.com/someone/todo-app",
    rubric: await read("../../examples/rubric.md"),
  });
  assert.equal(status, 200);
  assert.equal(body.report.score.possible > 0, true);
});

test("ACCESS_CODE guards the model routes but not health", async () => {
  process.env.ACCESS_CODE = "open-sesame";
  try {
    const call = (path, code) => fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(code && { "x-access-code": code }) },
      body: JSON.stringify({ repoUrl: "https://github.com/someone/todo-app", rubric: "- API (10 pts)" }),
    });
    for (const path of ["/api/analyze", "/api/review"]) {
      assert.equal((await call(path)).status, 401);
      const wrong = await call(path, "nope");
      assert.equal(wrong.status, 401);
      assert.match((await wrong.json()).error, /access code/);
      assert.equal((await call(path, "open-sesame")).status, 200);
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    delete process.env.ACCESS_CODE;
  }
});

// --- Starter repo comparison ---

const STARTER_APP = `import { loadWorkers } from "./data.js";

export function renderPage() {
  const workers = loadWorkers();
  loadWorkers();
  return workers.map(w => w.name).join(", ");
}
`;
const CANDIDATE_APP = `import { loadWorkers } from "./data.js";
import { filterByPrice } from "./filters.js";

export function renderPage(maxPrice) {
  const workers = loadWorkers();
  return filterByPrice(workers, maxPrice).map(w => w.name).join(", ");
}
`;
const SHARED_FILES = {
  "README.md": "# Workers starter\n\nRun npm install, then npm start.\n",
  "package.json": '{\n  "name": "workers-starter"\n}\n',
  "src/data.js": 'export const loadWorkers = () => [{ name: "Asha", price: 500 }];\n',
};
const STARTER_FILES = { ...SHARED_FILES, "src/app.js": STARTER_APP, "src/legacy.js": "export const legacy = true;\n" };
const CANDIDATE_FILES = {
  ...SHARED_FILES,
  "src/app.js": CANDIDATE_APP,
  "src/filters.js": "export const filterByPrice = (workers, maxPrice) =>\n  workers.filter(w => w.price <= maxPrice);\n",
};

let tmp, starterDir, candidateDir;
const writeRepo = async (dir, files) => {
  for (const [p, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, p)), { recursive: true });
    await writeFile(path.join(dir, p), content);
  }
};
before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "starter-test-"));
  starterDir = path.join(tmp, "starter");
  candidateDir = path.join(tmp, "candidate");
  await writeRepo(starterDir, STARTER_FILES);
  await writeRepo(candidateDir, CANDIDATE_FILES);
});
after(() => rm(tmp, { recursive: true, force: true }));

const RUBRIC = normalizeRubric("- Filters (10 pts)");
const candidateVsStarter = () => fetchRepoSnapshot(candidateDir, { starter: starterDir });

test("line diff finds changed ranges and removed lines", () => {
  const { changed, removed, removedCount } = diffLines(STARTER_APP, CANDIDATE_APP);
  assert.deepEqual(changed, [[2, 2], [4, 4], [6, 6]]);
  assert.equal(removedCount, 3);
  assert.ok(removed.some(l => l.trim() === "loadWorkers();"));
  assert.deepEqual(diffLines("a\nb\n", "a\r\nb\r\n").changed, []); // line endings alone aren't a change
  assert.deepEqual(diffLines("", "x\ny").changed, [[1, 2]]);
  assert.deepEqual(diffLines("a\nb\nc", "a\nc"), { changed: [], removed: ["b"], removedCount: 1 });
});

test("classifies files by SHA, honoring the candidate's subfolder", () => {
  const starter = [{ path: "a.js", sha: "1" }, { path: "b.js", sha: "2" }, { path: "gone.js", sha: "3" }];
  const candidate = [{ path: "hw/a.js", sha: "1" }, { path: "hw/b.js", sha: "9" }, { path: "hw/new.js", sha: "4" }];
  assert.deepEqual(classifyChanges(candidate, starter, "hw/"), {
    added: ["hw/new.js"], modified: ["hw/b.js"], unchanged: ["hw/a.js"], deleted: ["gone.js"],
  });
});

test("snapshot with a starter reads the candidate's files first and records what changed", async () => {
  const snap = await candidateVsStarter();
  assert.deepEqual(snap.changes.added, ["src/filters.js"]);
  assert.deepEqual(snap.changes.modified.map(m => m.path), ["src/app.js"]);
  assert.deepEqual(snap.changes.modified[0].changedLines, [[2, 2], [4, 4], [6, 6]]);
  assert.deepEqual(snap.changes.deleted, ["src/legacy.js"]);
  assert.equal(snap.changes.unchanged.length, 3);
  assert.deepEqual(snap.files.slice(0, 2).map(f => f.change).sort(), ["added", "modified"]);
  assert.equal(snap.files.find(f => f.path === "README.md").change, "unchanged");
  assert.equal((await fetchRepoSnapshot(candidateDir)).changes, undefined); // no starter, no comparison
});

test("review prompt marks the candidate's lines and keeps line numbers exact", async () => {
  const snap = await candidateVsStarter();
  const prompt = buildReviewPrompt({ snapshot: snap, criteria: "Add filters", rubric: RUBRIC });
  assert.match(prompt, /## Candidate's changes vs starter/);
  assert.match(prompt, /### FILE: src\/filters\.js \[added by the candidate\]\n\+ 1 \| export const filterByPrice/);
  assert.match(prompt, /### FILE: src\/app\.js \[modified by the candidate, changed lines 2, 4, 6\]\n  1 \| import \{ loadWorkers \}.*\n\+ 2 \| import \{ filterByPrice \}/);
  assert.match(prompt, /### FILE: README\.md \[unchanged starter code\]\n  1 \| # Workers starter/);
  assert.match(prompt, /removed 3 starter line/);
  assert.equal(verifyEvidence({ file: "src/app.js", startLine: 2, quote: "import { filterByPrice }", kind: "strength" }, snap).status, "verified");

  const plain = buildReviewPrompt({ snapshot: await fetchRepoSnapshot(candidateDir), criteria: "Add filters", rubric: RUBRIC });
  assert.doesNotMatch(plain, /Candidate's changes vs starter|\+ 1 \|/);
});

test("question prompt targets the diff and doesn't assume work", async () => {
  const prompts = buildSectionPrompts(await candidateVsStarter(), "", { assignmentBrief: "Add filters" });
  const prompt = prompts.assignment_resume;
  assert.doesNotMatch(prompts.backend, /Changes vs the Starter|filterByPrice/);
  assert.doesNotMatch(prompt, /\[unchanged starter code\]/); // only the candidate's files are excerpted
  assert.match(prompt, /## Candidate's Changes vs the Starter/);
  assert.match(prompt, /### File: src\/app\.js \[modified by the candidate, changed lines 2, 4, 6\]\n```\n  import \{ loadWorkers \}.*\n\+ import \{ filterByPrice \}/);
  assert.match(prompt, /Never assume a task was done unless the diff shows it/);
  assert.doesNotMatch(buildSectionPrompts(await fetchRepoSnapshot(candidateDir), "").assignment_resume, /Changes vs the Starter/);
});

test("an unmodified template gets a red flag, and credit for starter code is called out", async () => {
  const FLAG = "No changes compared to the starter repo: the submission is the unmodified template.";
  const same = await fetchRepoSnapshot(starterDir, { starter: starterDir });
  assert.ok(buildReport({ raw: { items: [] }, snapshot: same, rubric: RUBRIC }).redFlags.includes(FLAG));
  assert.match(buildReviewPrompt({ snapshot: same, criteria: "", rubric: RUBRIC }), /changed NOTHING/);

  const snap = await candidateVsStarter();
  assert.ok(!buildReport({ raw: { items: [] }, snapshot: snap, rubric: RUBRIC }).redFlags.includes(FLAG));
  assert.ok(!buildReport({ raw: { items: [] }, snapshot: await fetchRepoSnapshot(candidateDir), rubric: RUBRIC }).redFlags.includes(FLAG));

  const rate = evidence => buildReport({ raw: { items: [{ rubricId: "R1", rating: "meets", confidence: "high", evidence }] }, snapshot: snap, rubric: RUBRIC }).items[0];
  const onStarter = rate([{ file: "src/data.js", startLine: 1, quote: "loadWorkers", kind: "strength" }]);
  assert.ok(onStarter.warnings.includes("credited_starter_code"));
  assert.equal(onStarter.confidence, "low");
  assert.equal(onStarter.evidence[0].starterCode, true);
  const onOwn = rate([{ file: "src/filters.js", startLine: 1, quote: "filterByPrice", kind: "strength" }]);
  assert.deepEqual(onOwn.warnings, []);
  assert.equal(onOwn.confidence, "high");
});

// A tiny fake of the GitHub API, so the real fetcher runs without a network.
const gitSha = content => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
function stubGithub(repos) {
  const realFetch = globalThis.fetch;
  const downloads = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname !== "api.github.com") return realFetch(url, init);
    const [, , owner, repo, kind, ...rest] = u.pathname.split("/");
    const files = repos[`${owner}/${repo}`];
    const json = body => new Response(JSON.stringify(body), { status: 200 });
    if (!files) return new Response("{}", { status: 404 });
    if (!kind) return json({ name: repo, default_branch: "main", language: "JavaScript" });
    if (kind === "git") return json({ tree: Object.entries(files).map(([p, c]) => ({ path: p, type: "blob", size: c.length, sha: gitSha(c) })) });
    if (kind === "commits") return json(repo === "starter"
      ? [{ sha: "s1", commit: { message: "Initial starter" } }]
      : [{ sha: "c1", commit: { message: "Add filters" } }, { sha: "s1", commit: { message: "Initial starter" } }]);
    const p = rest.join("/");
    downloads.push(`${repo}:${p}`);
    return json({ content: Buffer.from(files[p]).toString("base64") });
  };
  return { downloads, restore: () => { globalThis.fetch = realFetch; } };
}

test("POST /api/analyze with starterUrl compares repos over the GitHub API", async () => {
  const prompts = [];
  const stubLlm = async ({ system, user }) => {
    prompts.push(user);
    return /first-time interviewers/.test(system) ? JSON.stringify(QUESTIONS) : JSON.stringify({ items: [] });
  };
  const app = createApp({ llm: stubLlm });
  const srv = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const call = body => fetch(`http://localhost:${srv.address().port}/api/analyze`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(async res => ({ status: res.status, body: await res.json() }));
  const github = stubGithub({ "acme/starter": STARTER_FILES, "ananya/work": CANDIDATE_FILES });
  try {
    const repoUrl = "https://github.com/ananya/work";
    const { status, body } = await call({ repoUrl, starterUrl: " https://github.com/acme/starter ", rubric: "- Filters (10 pts)" });
    assert.equal(status, 200);
    assert.deepEqual(body.errors, {});
    assert.deepEqual(body.repo.changes, { starter: "https://github.com/acme/starter", added: 1, modified: 1, unchanged: 3, deleted: 1 });
    assert.equal(body.review.report.repo.changes.added, 1);
    assert.match(body.review.markdown, /Compared with the starter/);
    // Only the modified file is downloaded from the starter, and only once.
    assert.deepEqual(github.downloads.filter(d => d.startsWith("starter:")), ["starter:src/app.js"]);
    assert.equal(prompts.length, 5); // the review plus four question sections
    assert.equal(prompts.filter(p => /src\/filters\.js \[added by the candidate\]/.test(p)).length, 2);
    assert.ok(prompts.some(p => /Add filters\n/.test(p) && /Initial starter \(starter\)/.test(p)));

    const same = await call({ repoUrl: "https://github.com/acme/starter", starterUrl: "https://github.com/acme/starter", rubric: "- Filters (10 pts)" });
    assert.ok(same.body.review.report.redFlags.some(f => f.startsWith("No changes compared to the starter repo")));

    const blank = await call({ repoUrl, starterUrl: "  " });
    assert.equal(blank.status, 200);
    assert.equal(blank.body.repo.changes, undefined);

    for (const starterUrl of ["/etc", "https://example.com/github.com/a/b", 42]) {
      assert.equal((await call({ repoUrl, starterUrl })).status, 400);
    }
    const missing = await call({ repoUrl, starterUrl: "https://github.com/acme/nope" });
    assert.equal(missing.status, 502);
    assert.match(missing.body.error, /Could not read the starter repo/);
  } finally {
    github.restore();
    srv.close();
  }
});
