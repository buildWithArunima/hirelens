// test-questions.js
// Live run: fetches a repo, generates the intern question guide and saves it.
// Usage: node tests/test-questions.js <github-url> [resume.txt] [brief.txt]
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { fetchRepoSnapshot } from "../backend/src/lib/githubFetcher.js";
import { generateInterviewQuestions } from "../backend/src/lib/questions.js";

const [repoUrl = "https://github.com/amruthpillai/BeThriftyToday", resumePath, briefPath] = process.argv.slice(2);
const resumeText = readFileSync(resumePath || new URL("./fixtures/sample-resume.txt", import.meta.url), "utf8");
const assignmentBrief = briefPath ? readFileSync(briefPath, "utf8") : "";

console.log("Step 1: Fetching repo...");
const repoData = await fetchRepoSnapshot(repoUrl);
console.log("✅ Repo fetched:", repoData.name, `(${repoData.files.length} files)`);

console.log("\nStep 2: Generating questions...");
const guide = await generateInterviewQuestions(repoData, resumeText, { assignmentBrief });
writeFileSync("./questions-output.json", JSON.stringify(guide, null, 2));

console.log("\n=== CANDIDATE SNAPSHOT ===\n", guide.candidate_snapshot.summary);
guide.questions.forEach((q, i) => {
  console.log(`\n[${i + 1}] [${q.category} · ${q.difficulty}] ${q.source.reference}`);
  console.log("Q:", q.question);
  console.log("Model answer:", q.model_answer);
  console.log("Listen for:", q.key_points.join("; "));
  q.follow_ups.forEach(f => console.log(`  ↳ (${f.type}) ${f.question}`));
});
console.log("\n✅ Saved full guide to questions-output.json");
