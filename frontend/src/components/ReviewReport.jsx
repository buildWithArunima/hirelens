// src/components/ReviewReport.jsx
import { useState } from "react";

const RATING_STYLE = {
  strong: "bg-green-100 text-green-800",
  meets: "bg-emerald-100 text-emerald-800",
  partial: "bg-yellow-100 text-yellow-800",
  minimal: "bg-orange-100 text-orange-800",
  missing: "bg-red-100 text-red-800",
  not_assessable: "bg-gray-100 text-gray-700",
};
const REQUIREMENT_ICON = { met: "✅", partial: "🟡", not_met: "❌", unclear: "❔" };

export function ReviewReport({ report, markdown }) {
  const { score } = report;

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${report.repo.name || "review"}-review.md` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div>
          <p className="text-3xl font-bold">{score.percent ?? "–"}%</p>
          <p className="text-sm text-gray-500">{score.earned} / {score.possible} pts</p>
        </div>
        <p className="font-medium">{score.recommendation.label}</p>
        <button onClick={download} className="ml-auto text-sm border rounded px-3 py-1">Download Markdown</button>
      </div>

      {report.overallSummary && <p className="text-gray-700">{report.overallSummary}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <List title="Strengths" items={report.topStrengths} />
        <List title="Growth areas" items={report.growthAreas} />
      </div>
      <List title="Red flags" items={report.redFlags} tone="text-red-700" />

      {report.requirements.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Requirements</h3>
          <ul className="text-sm space-y-1">
            {report.requirements.map((r, i) => (
              <li key={i}>
                {REQUIREMENT_ICON[r.status]} {r.requirement}
                {r.where && <span className="text-gray-500 font-mono text-xs"> ({r.where})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2">Rubric items</h3>
        {report.items.map(item => <RubricItem key={item.id} item={item} />)}
      </div>
    </div>
  );
}

function RubricItem({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg mb-3 p-4 bg-white">
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="font-medium">{item.criterion}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
            <span className={`px-2 py-0.5 rounded ${RATING_STYLE[item.rating]}`}>{item.ratingLabel}</span>
            <span className="text-gray-600">{item.points ?? "–"} / {item.maxPoints} pts</span>
            <span className="text-gray-500">confidence: {item.confidence}</span>
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className="text-gray-400 text-sm shrink-0">{open ? "Hide" : "Details"}</button>
      </div>
      {item.summary && <p className="text-sm text-gray-700 mt-2">{item.summary}</p>}

      {open && (
        <div className="mt-3 space-y-3 text-sm text-gray-700">
          {item.evidence.map((ev, i) => (
            <div key={i}>
              <p>
                {ev.kind === "gap" ? "⚠️" : "✔️"}{" "}
                {ev.file && <span className="font-mono text-xs">{ev.file}{ev.startLine ? `:${ev.startLine}-${ev.endLine}` : ""}</span>}{" "}
                {ev.note}
                {!["verified", "line_mismatch", "absence"].includes(ev.status) && (
                  <span className="text-orange-600 text-xs"> (couldn't verify: {ev.status.replace(/_/g, " ")})</span>
                )}
                {ev.starterCode && <span className="text-orange-600 text-xs"> (starter code, not the candidate's)</span>}
              </p>
              {ev.snippet && <pre className="bg-gray-50 border rounded p-2 mt-1 overflow-x-auto text-xs">{ev.snippet}</pre>}
            </div>
          ))}
          {item.improvementTip && <p><strong>Tip for the candidate:</strong> {item.improvementTip}</p>}
          {item.probeQuestion && <p><strong>Ask in the interview:</strong> {item.probeQuestion}</p>}
        </div>
      )}
    </div>
  );
}

function List({ title, items, tone = "" }) {
  if (!items?.length) return null;
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      <ul className={`list-disc ml-5 text-sm space-y-1 ${tone}`}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
