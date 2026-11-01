# HireLens

HireLens: AI assignment reviewer and interview guide for hiring full stack interns.

**Live demo:** <add Render URL>

<!-- TODO: add screenshots of the review and the interview guide -->

## What it does

- **Rubric review with line-verified evidence.** Every rating cites file, lines and an exact quote, and each citation is checked against the real code. Scores are computed in code, not by the model.
- **Starter-repo diff.** Give it the template an assignment was built on and only the candidate's own changes earn credit. An untouched template is flagged.
- **Time-boxed interview guide.** A plan of up to 80 minutes: 55% backend fundamentals, 25% problem solving (DSA, SQL and a puzzle, prompted to be original with complete statements), 10% frontend, and short checks on the assignment and resume. Each question comes with a model answer, what to listen for and follow-ups.

## Tech stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js, Express
- **AI:** Google Gemini through an OpenAI-compatible API, with fallback across models and support for other compatible providers

## Run locally

Needs Node 18.18 or newer.

```
npm install
cp .env.example .env    # then fill in GEMINI_API_KEY (and optionally GITHUB_TOKEN)
npm run dev             # API on :3001, UI on http://localhost:5173
```

To run it as a single server instead (Express serves the UI and API on http://localhost:3001):

```
npm run build
npm start
```

All model calls go through the backend with one provider, chosen by the key you set: `GEMINI_API_KEY` (Google Gemini, free key at aistudio.google.com, default model `gemini-flash-latest`), `NVIDIA_API_KEY`, or `LLM_API_KEY` plus `LLM_BASE_URL` for any other OpenAI-compatible provider. `LLM_MODEL` forces a model. Keys never reach the browser.

Paste a repo URL, the assignment criteria, the rubric and the candidate's resume, then press Analyze. You get two tabs: the scored assignment review and the interview guide, each downloadable as Markdown. Leave the rubric empty to get questions only.

## Deploy to Render

`render.yaml` is a Render Blueprint for one free web service. In the Render dashboard choose **New > Blueprint**, pick this repo, and set:

- `GEMINI_API_KEY` (required)
- `GITHUB_TOKEN` (optional, avoids GitHub's limit of 60 requests an hour)
- `ACCESS_CODE` (optional but recommended: visitors must enter it, so a public link can't use up your model quota)

The free tier sleeps after 15 minutes idle, so the first load after that takes about a minute.

## How the review works

Give it a candidate's GitHub repo, the assignment criteria and your rubric, and it returns a scored review where every rating is backed by file and line evidence from the code. It grades against a lenient, intern-level bar meant for an early interview round.

### How it works

1. **Fetch** (`backend/src/lib/githubFetcher.js`): reads the repo tree, skips noise (node_modules, lockfiles, builds, images) and fetches up to 40 of the most relevant files (README, configs, routes, models, components, tests). It also reads recent commit messages and flags things like a committed `.env`. Works with `https://github.com/owner/repo`, `.../tree/<branch>/<subfolder>`, or a local folder.
2. **Review** (`backend/src/prompts/reviewPrompt.js`): the model sees line-numbered code and rates each rubric item on a fixed scale, citing file, lines and an exact quote for each piece of evidence.
3. **Verify and score** (`backend/src/lib/evidence.js`, `backend/src/api/analyze.js`): every citation is checked against the real code. Wrong line numbers are corrected, invented files or quotes are flagged, and a positive rating with no verified evidence is marked low confidence. Points are computed in code from the rating, not by the model.
4. **Report** (`backend/src/lib/reportMarkdown.js`): Markdown with a scorecard, requirements checklist, strengths and growth areas, and per-item evidence with real code snippets, a tip for the candidate and a question to ask in the interview. See `examples/sample-report.md`.

### Rating scale

| Rating | Points | Meaning |
|---|---|---|
| Strong | 100% | Above the intern bar |
| Meets intern bar | 75% | Main flow works with a reasonable approach; rough edges are fine |
| Partially meets | 50% | Real attempt with notable gaps |
| Minimal | 25% | Token attempt or mostly broken |
| Not found | 0% | No evidence it was attempted |
| Can't assess | excluded | Not enough code to judge; check in the interview |

Recommendation bands: 80%+ strong advance, 60%+ advance, 45%+ borderline, below that below the intern bar.

### Rubric format

Plain text, one item per line, with points in brackets (items without points default to 10):

```
- Functionality (25 pts): All CRUD operations work end to end from the UI.
- Testing (5 pts): Any automated tests, even a few, are a plus.
```

or JSON: `[{"criterion": "Functionality", "description": "...", "maxPoints": 25}]`.

### Assignments built on a starter repo

If candidates start from a template, put its URL in the optional **Starter repo** field (`starterUrl` in the API, `--starter <url|folder>` on the CLI). The app compares the two repos by git blob SHA, reads the candidate's added and modified files first, and marks the lines they wrote. Only those changes earn credit; unchanged starter code can only be cited as a gap, and the questions stop treating it as the candidate's work. If nothing changed, the report gets a red flag saying the submission is the unmodified template. Leave the field blank when the candidate built from scratch.

## Interview guide

You set the interview length (36 to 80 minutes, default 80) and the guide is sized to fit, in code rather than left to the model. After 5 minutes for the intro, time is split 55% backend fundamentals, 25% problem solving, 10% frontend, 5% checking the candidate really built the assignment, and 5% resume, with fixed times per item (4 minutes for a question, 10 for DSA, 5 for SQL, 4 for a puzzle).

| Length | Assignment | Resume | Backend | Frontend | DSA | SQL | Puzzle | Questions | Planned minutes |
|---|---|---|---|---|---|---|---|---|---|
| 80 | 1 | 1 | 10 | 2 | 1 | 1 | 1 | 17 | 80 |
| 60 | 1 | 1 | 7 | 1 | 1 | 1 | 0 | 12 | 60 |
| 45 | 1 | 1 | 3 | 1 | 1 | 1 | 0 | 8 | 44 |

Short interviews always keep one DSA and one SQL problem, so backend gives way and its share shrinks below 55%.

Each section is its own model call with only the context it needs, so if one fails the rest still arrive, and the failure is shown in the guide.

Every question comes with a model answer, what to listen for, a good-intern bar, common wrong answers, red flags and two follow-ups (go deeper, or if they get stuck), plus an optional bonus when time allows. DSA, SQL and puzzle items carry a complete problem statement plus interviewer notes. DSA problems are prompted to be fresh scenarios rather than copies from coding sites, but that is the model's judgment, so skim them before the call. The guide can be downloaded as Markdown.

## Run from the command line

```
npm run review -- --repo https://github.com/owner/repo \
  --criteria examples/criteria.md --rubric examples/rubric.md \
  --starter https://github.com/company/assignment-template \
  --out review.md --json review.json
```

## API

```
POST /api/analyze
{ "repoUrl": "https://github.com/owner/repo", "starterUrl": "(optional)", "criteria": "...", "rubric": "...", "resume": "...", "interviewMinutes": 80 }
-> { "repo": {...}, "review": { "report": {...}, "markdown": "..." } | null, "questions": {...} | null, "errors": {} }

POST /api/review
{ "repoUrl": "...", "starterUrl": "(optional)", "criteria": "...", "rubric": "..." }
-> { "report": {...}, "markdown": "..." }
```

`/api/analyze` fetches the repo once and runs the review and the questions side by side, so one failing doesn't hide the other. The web API only accepts GitHub URLs; local folders work from the CLI.

## Tests

No API key or network needed: `npm test`

Live scripts (need `.env`): `node tests/test-github.js <url>`, `node tests/test-questions.js <url>`, and with the server running, `node tests/test-pipeline.js <url>`.
