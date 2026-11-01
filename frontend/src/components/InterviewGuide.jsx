// src/components/InterviewGuide.jsx
import { QuestionCard } from "./QuestionCard.jsx";
import { SECTIONS, planSummary, renderGuideMarkdown } from "../services/guideMarkdown.js";

export function InterviewGuide({ guide, repoName }) {
  const download = () => {
    const blob = new Blob([renderGuideMarkdown(guide, repoName)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${repoName || "interview"}-questions.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  let number = 0;
  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <p className="text-sm font-medium text-gray-700">{planSummary(guide)}</p>
        <button onClick={download} className="text-sm text-blue-600 underline">Download questions (Markdown)</button>
      </div>

      {guide.errors.map((e, i) => <p key={i} className="text-red-500 text-sm mb-2">{e}</p>)}

      {guide.candidate_snapshot.summary && (
        <div className="bg-white border rounded-lg p-4 mb-4 text-sm text-gray-700">
          <p>{guide.candidate_snapshot.summary}</p>
          {guide.candidate_snapshot.resume_claims_to_verify.length > 0 && (
            <p className="mt-2"><strong>Resume claims to verify:</strong> {guide.candidate_snapshot.resume_claims_to_verify.join("; ")}</p>
          )}
        </div>
      )}

      {SECTIONS.map(({ key, label }) => {
        const questions = guide.questions.filter(q => q.section === key);
        if (!questions.length) return null;
        return (
          <section key={key} className="mb-6">
            <h2 className="text-lg font-semibold mb-2">{label}</h2>
            {questions.map(q => {
              const index = ++number;
              return <QuestionCard key={index} question={q} index={index} />;
            })}
          </section>
        );
      })}
    </>
  );
}
