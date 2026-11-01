// test-github.js
// Live check of the repo fetcher. Usage: node tests/test-github.js [github-url]
import "dotenv/config";
import { fetchRepoSnapshot } from "../backend/src/lib/githubFetcher.js";

const [repoUrl = "https://github.com/amruthpillai/BeThriftyToday"] = process.argv.slice(2);
const snapshot = await fetchRepoSnapshot(repoUrl);
console.log("Repo name:", snapshot.name);
console.log("Language:", snapshot.language);
console.log(`Files fetched: ${snapshot.files.length} of ${snapshot.totalFiles}`);
console.log("File paths:", snapshot.files.map(f => f.path));
console.log("Signals:", snapshot.signals);
