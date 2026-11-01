// src/components/QuestionCard.jsx
import { useState } from "react";
import { FOLLOW_UP_LABEL } from "../services/guideMarkdown.js";

const DIFFICULTY_STYLE = {
  "warm-up": "bg-green-100 text-green-800",
  core: "bg-blue-100 text-blue-800",
  stretch: "bg-purple-100 text-purple-800",
};

export function QuestionCard({ question, index }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg mb-3 p-4 bg-white">
      <div className="flex justify-between items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-blue-500">{question.category}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${DIFFICULTY_STYLE[question.difficulty] || "bg-gray-100"}`}>
            {question.difficulty}
          </span>
          <span className="text-xs text-gray-500">~{question.time_minutes} min</span>
          {question.source?.reference && (
            <span className="text-xs text-gray-500 font-mono">{question.source.reference}</span>
          )}
        </div>
        <button onClick={() => setOpen(!open)} className="text-gray-400 text-sm shrink-0">
          {open ? "Hide" : "Details"}
        </button>
      </div>
      <p className="font-medium mt-1">Q{index}: {question.question}</p>
      {question.problem && <ProblemStatement problem={question.problem} />}

      {open && (
        <div className="mt-3 space-y-3 text-sm text-gray-700">
          {question.why && <p><strong>Why ask this:</strong> {question.why}</p>}
          <Answer answer={question.model_answer} keyPoints={question.key_points} />
          {question.pass_bar && <p><strong>Good intern bar:</strong> {question.pass_bar}</p>}
          <List title="Common wrong answers" items={question.common_wrong_answers} />
          {question.red_flags.length > 0 && (
            <p className="text-red-600"><strong>Red flags:</strong> {question.red_flags.join(" ")}</p>
          )}
          {question.problem && <InterviewerNotes problem={question.problem} />}
          {question.follow_ups.map((f, i) => (
            <div key={i} className="border-l-4 border-gray-200 pl-3">
              <p>
                <strong>{FOLLOW_UP_LABEL[f.type] || "Follow-up"}:</strong> {f.question}
              </p>
              <Answer answer={f.model_answer} keyPoints={f.key_points} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// What the candidate gets to see, so it stays visible without opening Details.
function ProblemStatement({ problem: p }) {
  return (
    <div className="mt-3 space-y-2 text-sm text-gray-700 bg-gray-50 border rounded p-3">
      {p.title && <p className="font-semibold">{p.title}</p>}
      {p.scenario && <p className="whitespace-pre-wrap">{p.scenario}</p>}
      {p.task && <p className="whitespace-pre-wrap"><strong>Task:</strong> {p.task}</p>}
      {p.input_format && <p className="whitespace-pre-wrap"><strong>Input:</strong> {p.input_format}</p>}
      {p.output_format && <p className="whitespace-pre-wrap"><strong>Output:</strong> {p.output_format}</p>}
      <List title="Constraints" items={p.constraints} />
      {p.examples.map((e, i) => (
        <div key={i}>
          <strong>Example {i + 1}</strong>
          <Pre>{`Input: ${e.input}\nOutput: ${e.output}`}</Pre>
          {e.explanation && <p className="mt-1 whitespace-pre-wrap">{e.explanation}</p>}
        </div>
      ))}
      <List title="Clarifications" items={p.clarifications} />
      <Block title="Schema">{p.schema_sql}</Block>
      <Block title="Sample data">{p.sample_data}</Block>
      <Block title="Expected output">{p.expected_output}</Block>
    </div>
  );
}

function InterviewerNotes({ problem: p }) {
  const [open, setOpen] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);

  return (
    <div className="border rounded p-3">
      <button onClick={() => setOpen(!open)} className="font-medium text-blue-600">
        {open ? "Hide interviewer notes" : "Show interviewer notes"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {p.pattern && <p><strong>Pattern:</strong> {p.pattern}</p>}
          {p.brute_force && <p className="whitespace-pre-wrap"><strong>Brute force:</strong> {p.brute_force}</p>}
          {p.optimal_approach && <p className="whitespace-pre-wrap"><strong>Optimal approach:</strong> {p.optimal_approach}</p>}
          {p.complexity && <p><strong>Complexity:</strong> {p.complexity}</p>}
          <Block title="Reference solution">{p.reference_solution}</Block>
          <List title="Edge cases" items={p.edge_cases} />
          {p.hints.length > 0 && (
            <div>
              <strong>Hints</strong>
              <ol className="list-decimal ml-5">
                {p.hints.slice(0, hintsShown).map((h, i) => <li key={i}>{h}</li>)}
              </ol>
              {hintsShown < p.hints.length && (
                <button onClick={() => setHintsShown(hintsShown + 1)} className="text-blue-600 underline">
                  Show next hint
                </button>
              )}
            </div>
          )}
          <List title="Common mistakes" items={p.common_mistakes} />
        </div>
      )}
    </div>
  );
}

function Answer({ answer, keyPoints = [] }) {
  return (
    <>
      {answer && <p><strong>Good answer:</strong> {answer}</p>}
      <List title="Listen for" items={keyPoints} />
    </>
  );
}

function List({ title, items = [] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong>{title}:</strong>
      <ul className="list-disc ml-5">
        {items.map((k, i) => <li key={i}>{k}</li>)}
      </ul>
    </div>
  );
}

function Block({ title, children }) {
  if (!children) return null;
  return (
    <div>
      <strong>{title}</strong>
      <Pre>{children}</Pre>
    </div>
  );
}

function Pre({ children }) {
  return <pre className="bg-white border rounded p-2 mt-1 overflow-x-auto text-xs">{children}</pre>;
}
