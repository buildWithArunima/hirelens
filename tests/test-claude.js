// test-claude.js
// Saves the question prompt for a repo to prompt-preview.txt without calling the model.
// Usage: node tests/test-claude.js [github-url]
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { fetchRepoSnapshot } from "../backend/src/lib/githubFetcher.js";
import { buildSectionPrompts } from "../backend/src/lib/questions.js";

const [repoUrl = "https://github.com/amruthpillai/BeThriftyToday"] = process.argv.slice(2);
const resume = new URL("./fixtures/sample-resume.txt", import.meta.url);
const prompt = buildSectionPrompts(await fetchRepoSnapshot(repoUrl), readFileSync(resume, "utf8")).assignment_resume;
writeFileSync("./prompt-preview.txt", prompt);
console.log(prompt);
console.log("=== CHAR COUNT:", prompt.length, "===");
