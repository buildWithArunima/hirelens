// backend/routes/analyze.js
import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { reviewAssignment } from "../src/api/analyze.js";
import { renderReportMarkdown } from "../src/lib/reportMarkdown.js";
import { changeCounts, fetchRepoSnapshot } from "../src/lib/githubFetcher.js";
import { generateInterviewQuestions } from "../src/lib/questions.js";

// deps.llm / deps.fetchSnapshot let tests run the routes without network or a model.
export function createAnalyzeRouter({ llm, fetchSnapshot = fetchRepoSnapshot } = {}) {
  const router = Router();
  router.post(["/review", "/analyze"], requireAccessCode);

  // POST /api/review { repoUrl, starterUrl?, criteria, rubric }  -> { report, markdown }
  router.post("/review", async (req, res) => {
    const { repoUrl, criteria, rubric } = req.body || {};
    const starterUrl = starterUrlOf(req.body);
    if (!isGithubUrl(repoUrl)) return res.status(400).json({ error: "repoUrl must be a GitHub URL" });
    if (starterUrl && !isGithubUrl(starterUrl)) return res.status(400).json({ error: "starterUrl must be a GitHub URL" });
    if (!rubric) return res.status(400).json({ error: "rubric is required" });
    try {
      const snapshot = await fetchSnapshot(repoUrl, starterUrl ? { starter: starterUrl } : undefined);
      const report = await reviewAssignment({ snapshot, criteria, rubric, llm });
      res.json({ report, markdown: renderReportMarkdown(report) });
    } catch (err) {
      console.error("Review failed:", err);
      res.status(502).json({ error: err.message });
    }
  });

  // POST /api/analyze { repoUrl, starterUrl?, criteria?, rubric?, resume?, interviewMinutes? }
  //   -> { repo, review: { report, markdown } | null, questions | null, errors }
  // Fetches the repo once, then runs the rubric review (when a rubric is given)
  // and the question guide side by side. One failing doesn't hide the other.
  router.post("/analyze", async (req, res) => {
    const { repoUrl, criteria = "", rubric = "", resume = "", interviewMinutes } = req.body || {};
    const starterUrl = starterUrlOf(req.body);
    if (!isGithubUrl(repoUrl)) return res.status(400).json({ error: "repoUrl must be a GitHub URL" });
    if (starterUrl && !isGithubUrl(starterUrl)) return res.status(400).json({ error: "starterUrl must be a GitHub URL" });

    let snapshot;
    try {
      snapshot = await fetchSnapshot(repoUrl, starterUrl ? { starter: starterUrl } : undefined);
      if (!snapshot.files.length) throw new Error("No reviewable source files found in the repo");
    } catch (err) {
      console.error("Repo fetch failed:", err);
      return res.status(502).json({ error: err.message });
    }

    const [review, questions] = await Promise.allSettled([
      rubric.trim()
        ? reviewAssignment({ snapshot, criteria, rubric, llm }).then(report => ({ report, markdown: renderReportMarkdown(report) }))
        : Promise.resolve(null),
      generateInterviewQuestions(snapshot, resume, { assignmentBrief: criteria, interviewMinutes, llm }),
    ]);

    const errors = {};
    if (review.status === "rejected") { console.error("Review failed:", review.reason); errors.review = review.reason.message; }
    if (questions.status === "rejected") { console.error("Questions failed:", questions.reason); errors.questions = questions.reason.message; }

    res.json({
      repo: {
        name: snapshot.name,
        language: snapshot.language,
        branch: snapshot.branch,
        filesReviewed: snapshot.files.map(f => f.path),
        totalFiles: snapshot.totalFiles,
        ...(snapshot.changes && { changes: changeCounts(snapshot.changes) }),
      },
      review: review.status === "fulfilled" ? review.value : null,
      questions: questions.status === "fulfilled" ? questions.value : null,
      errors,
    });
  });

  return router;
}

// When ACCESS_CODE is set, a public deployment can't spend the owner's model quota without it.
function requireAccessCode(req, res, next) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return next();
  const given = Buffer.from(String(req.get("x-access-code") || ""));
  const wanted = Buffer.from(expected);
  if (given.length === wanted.length && timingSafeEqual(given, wanted)) return next();
  res.status(401).json({ error: "This demo needs an access code. Ask the owner for one." });
}

// Only GitHub URLs from the web UI: local folder paths are for the CLI.
const isGithubUrl = url => typeof url === "string" && /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/.test(url.trim());

// Blank means no starter; anything else non-empty has to pass the URL check.
const starterUrlOf = body => (typeof body?.starterUrl === "string" ? body.starterUrl.trim() : body?.starterUrl || "");

export default createAnalyzeRouter();
