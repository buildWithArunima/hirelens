// test-pipeline.js
// Live end-to-end run through the HTTP API, the same path the web UI uses.
// Start the server first (npm run server), then:
//   node tests/test-pipeline.js [github-url]
import { readFileSync } from "fs";

const [repoUrl = "https://github.com/amruthpillai/BeThriftyToday"] = process.argv.slice(2);
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const base = `http://localhost:${process.env.PORT || 3001}`;

console.log(`POST ${base}/api/analyze for ${repoUrl} ...`);
const res = await fetch(`${base}/api/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    repoUrl,
    criteria: read("../examples/criteria.md"),
    rubric: read("../examples/rubric.md"),
    resume: read("./fixtures/sample-resume.txt"),
  }),
});
const data = await res.json();
if (!res.ok) throw new Error(data.error);

console.log(`✅ ${data.repo.name}: ${data.repo.filesReviewed.length} files read`);
if (data.review) {
  const { score } = data.review.report;
  console.log(`✅ Review: ${score.earned}/${score.possible} (${score.percent}%), ${score.recommendation.label}`);
}
if (data.questions) console.log(`✅ Questions: ${data.questions.questions.length}`);
if (Object.keys(data.errors).length) console.log("⚠️ Errors:", data.errors);
