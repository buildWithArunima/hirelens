// src/App.jsx
import { useState } from "react";
import { analyzeAssignment } from "./services/api.js";
import { RepoInput } from "./components/RepoInput.jsx";
import { LoadingState } from "./components/LoadingState.jsx";
import { ReviewReport } from "./components/ReviewReport.jsx";
import { InterviewGuide } from "./components/InterviewGuide.jsx";

const ACCESS_CODE_KEY = "hirelens-access-code";
const readSavedCode = () => {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) || "";
  } catch {
    return "";
  }
};
const saveCode = code => {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // Private windows can block storage; the code just won't be remembered.
  }
};

export default function App() {
  const [form, setForm] = useState({ repoUrl: "", starterUrl: "", criteria: "", rubric: "", resume: "", interviewMinutes: 80 });
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("review");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accessCode, setAccessCode] = useState(readSavedCode);
  const [needsCode, setNeedsCode] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await analyzeAssignment(form, accessCode);
      saveCode(accessCode);
      setNeedsCode(false);
      setResult(data);
      setTab(data.review ? "review" : "questions");
    } catch (e) {
      if (e.status === 401) setNeedsCode(true);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const guide = result?.questions;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold">HireLens</h1>
      <p className="text-gray-600 mb-4">
        Review a full stack intern's assignment against your rubric and get questions to ask, with answers to listen for.
      </p>

      <RepoInput values={form} onChange={setForm} onSubmit={handleAnalyze} loading={loading} />

      {needsCode && (
        <form
          className="flex flex-wrap items-center gap-2 bg-white border rounded-lg p-4 mb-4"
          onSubmit={e => {
            e.preventDefault();
            handleAnalyze();
          }}
        >
          <label className="text-sm font-medium" htmlFor="access-code">Access code</label>
          <input
            id="access-code"
            type="password"
            className="border rounded px-3 py-1"
            value={accessCode}
            onChange={e => setAccessCode(e.target.value)}
          />
          <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50" disabled={loading}>
            Continue
          </button>
        </form>
      )}

      {loading && <LoadingState />}
      {error && <p className="text-red-500 mb-4">{error}</p>}

      {result && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            Analyzed: <strong>{result.repo.name}</strong>
            {result.repo.language && ` (${result.repo.language})`}, {result.repo.filesReviewed.length} of {result.repo.totalFiles} files read
            {result.repo.changes && `, candidate added ${result.repo.changes.added} and changed ${result.repo.changes.modified} compared with the starter`}
          </p>

          <div className="flex gap-2 mb-4 border-b">
            <TabButton active={tab === "review"} onClick={() => setTab("review")}>Assignment review</TabButton>
            <TabButton active={tab === "questions"} onClick={() => setTab("questions")}>
              Interview questions{guide ? ` (${guide.questions.length})` : ""}
            </TabButton>
          </div>

          {tab === "review" && (
            result.review ? <ReviewReport {...result.review} />
            : result.errors.review ? <p className="text-red-500">Review failed: {result.errors.review}</p>
            : <p className="text-gray-500">Add a rubric above to get a scored review.</p>
          )}

          {tab === "questions" && (
            guide ? <InterviewGuide guide={guide} repoName={result.repo.name} />
            : <p className="text-red-500">Question generation failed: {result.errors.questions}</p>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 -mb-px border-b-2 ${active ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-gray-500"}`}
    >
      {children}
    </button>
  );
}
