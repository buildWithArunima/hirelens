// scripts/review.js
// Usage:
//   node scripts/review.js --repo <github-url|local-folder> --rubric examples/rubric.md \
//     [--starter <github-url|local-folder>] [--criteria examples/criteria.md] [--out review.md] [--json review.json]
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { reviewAssignment } from "../backend/src/api/analyze.js";
import { renderReportMarkdown } from "../backend/src/lib/reportMarkdown.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
if (!args.repo || !args.rubric) {
  console.error("Usage: node scripts/review.js --repo <url|folder> --rubric <file> [--starter <url|folder>] [--criteria <file>] [--out review.md] [--json review.json]");
  process.exit(1);
}

const rubric = await readFile(args.rubric, "utf8");
const criteria = args.criteria ? await readFile(args.criteria, "utf8") : "";

console.error(`Reviewing ${args.repo} ...`);
const report = await reviewAssignment({ repo: args.repo, starter: args.starter, criteria, rubric });
const markdown = renderReportMarkdown(report);

if (args.json) await writeFile(args.json, JSON.stringify(report, null, 2));
if (args.out) {
  await writeFile(args.out, markdown);
  console.error(`Score ${report.score.earned}/${report.score.possible} (${report.score.percent}%), ${report.score.recommendation.label}. Report written to ${args.out}`);
} else {
  console.log(markdown);
}
