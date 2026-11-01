// src/components/RepoInput.jsx
import exampleCriteria from "../../../examples/criteria.md?raw";
import exampleRubric from "../../../examples/rubric.md?raw";

export function RepoInput({ values, onChange, onSubmit, loading }) {
  const set = field => e => onChange({ ...values, [field]: e.target.value });

  const loadResumeFile = async e => {
    const file = e.target.files?.[0];
    if (file) onChange({ ...values, resume: await file.text() });
  };

  return (
    <form
      className="space-y-4 bg-white border rounded-lg p-5 mb-6"
      onSubmit={e => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Assignment repo" hint="Public GitHub URL. A /tree/<branch>/<folder> link works too.">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="https://github.com/username/repo"
          value={values.repoUrl}
          onChange={set("repoUrl")}
          required
        />
      </Field>

      <Field label="Starter repo (optional)" hint="The template the candidate started from. Leave blank if they built from scratch.">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="https://github.com/company/assignment-template"
          value={values.starterUrl}
          onChange={set("starterUrl")}
        />
      </Field>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Assignment criteria" hint="What the candidate was asked to build.">
          <textarea className="w-full border rounded px-3 py-2 h-40 font-mono text-sm" value={values.criteria} onChange={set("criteria")} />
        </Field>
        <Field label="Rubric" hint="One item per line, e.g. “- Code quality (20 pts): readable”. Leave empty to skip the review.">
          <textarea className="w-full border rounded px-3 py-2 h-40 font-mono text-sm" value={values.rubric} onChange={set("rubric")} />
        </Field>
      </div>

      <Field label="Candidate resume" hint="Paste the text, or load a .txt / .md file.">
        <textarea className="w-full border rounded px-3 py-2 h-32 text-sm" value={values.resume} onChange={set("resume")} />
        <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={loadResumeFile} className="mt-2 text-sm" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">
          Interview length (minutes){" "}
          <input
            type="number"
            min={36}
            max={80}
            className="w-16 border rounded px-2 py-1 ml-1"
            value={values.interviewMinutes}
            onChange={set("interviewMinutes")}
          />
        </label>
        <button
          type="button"
          className="text-sm text-blue-600 underline"
          onClick={() => onChange({ ...values, criteria: exampleCriteria, rubric: exampleRubric })}
        >
          Use example todo-app criteria and rubric
        </button>
        <button type="submit" className="ml-auto bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50" disabled={loading}>
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block font-medium text-sm">{label}</span>
      {hint && <span className="block text-xs text-gray-500 mb-1">{hint}</span>}
      {children}
    </label>
  );
}
