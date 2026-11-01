// src/services/guideMarkdown.js
// Renders the interview guide to Markdown, for the download button.

export const SECTIONS = [
  { key: "assignment", label: "Assignment" },
  { key: "resume", label: "Resume" },
  { key: "backend", label: "Backend" },
  { key: "frontend", label: "Frontend" },
  { key: "problem_solving", label: "Problem solving" },
];

export const FOLLOW_UP_LABEL = { deeper: "Go deeper", stretch: "Bonus: only if time allows", hint: "If they get stuck" };

export const totalMinutes = questions => questions.reduce((sum, q) => sum + (q.time_minutes || 0), 0);

// "80 min plan · Intro 5 · Backend 10 (40m) · Frontend 2 (8m) · Problem solving 3 (19m) · Assignment 1 (4m) · Resume 1 (4m)"
export function planSummary(guide) {
  const plan = guide.interview_plan;
  const minutes = totalMinutes(guide.questions);
  if (!plan) return `${guide.questions.length} questions · ~${minutes} min`;
  const part = (label, s) => `${label} ${s.count} (${s.minutes}m)`;
  const { backend, frontend, problem_solving, assignment, resume } = plan.sections;
  return [
    `${plan.minutes} min plan`,
    `Intro ${plan.intro_minutes}`,
    part("Backend", backend),
    part("Frontend", frontend),
    part("Problem solving", problem_solving),
    part("Assignment", assignment),
    part("Resume", resume),
  ].join(" · ");
}

const fence = (text, lang = "") => (text ? ["```" + lang, text, "```", ""] : []);
const bullets = (title, items) => (items?.length ? [`**${title}**`, "", ...items.map(i => `- ${i}`), ""] : []);
const line = (title, text) => (text ? [`**${title}:** ${text}`, ""] : []);

function problemLines(p) {
  const examples = p.examples.flatMap((e, i) => [
    `**Example ${i + 1}**`,
    "",
    ...fence(`Input: ${e.input}\nOutput: ${e.output}`),
    ...(e.explanation ? [e.explanation, ""] : []),
  ]);
  return [
    ...(p.title ? [`**${p.title}**`, ""] : []),
    ...(p.scenario ? [p.scenario, ""] : []),
    ...line("Task", p.task),
    ...line("Input", p.input_format),
    ...line("Output", p.output_format),
    ...bullets("Constraints", p.constraints),
    ...examples,
    ...bullets("Clarifications", p.clarifications),
    ...(p.schema_sql ? ["**Schema**", "", ...fence(p.schema_sql, "sql")] : []),
    ...(p.sample_data ? ["**Sample data**", "", ...fence(p.sample_data, "sql")] : []),
    ...(p.expected_output ? ["**Expected output**", "", ...fence(p.expected_output)] : []),
    "**Interviewer notes**",
    "",
    ...line("Pattern", p.pattern),
    ...line("Brute force", p.brute_force),
    ...line("Optimal approach", p.optimal_approach),
    ...line("Complexity", p.complexity),
    ...(p.reference_solution ? ["**Reference solution**", "", ...fence(p.reference_solution, p.kind === "sql" ? "sql" : p.kind === "dsa" ? "js" : "")] : []),
    ...bullets("Edge cases", p.edge_cases),
    ...bullets("Hints", p.hints),
    ...bullets("Common mistakes", p.common_mistakes),
  ];
}

export function renderGuideMarkdown(guide, repoName = "") {
  const out = [`# Interview guide${repoName ? `: ${repoName}` : ""}`, "", planSummary(guide), ""];
  if (guide.candidate_snapshot.summary) out.push(guide.candidate_snapshot.summary, "");
  out.push(...bullets("Resume claims to verify", guide.candidate_snapshot.resume_claims_to_verify));
  if (guide.errors.length) out.push(...bullets("⚠️ Problems generating this guide", guide.errors));

  let number = 0;
  for (const { key, label } of SECTIONS) {
    const questions = guide.questions.filter(q => q.section === key);
    if (!questions.length) continue;
    out.push(`## ${label}`, "");
    for (const q of questions) {
      out.push(`### Q${++number}. ${q.question}`, "", `_${q.category} · ${q.difficulty} · ~${q.time_minutes} min_`, "");
      if (q.problem) out.push(...problemLines(q.problem));
      out.push(
        ...line("Why ask this", q.why),
        ...line("Good answer", q.model_answer),
        ...bullets("Listen for", q.key_points),
        ...line("Good intern bar", q.pass_bar),
        ...bullets("Common wrong answers", q.common_wrong_answers),
        ...bullets("Red flags", q.red_flags),
      );
      for (const f of q.follow_ups) {
        out.push(`**${FOLLOW_UP_LABEL[f.type] || "Follow-up"}:** ${f.question}`, "");
        out.push(...line("Good answer", f.model_answer), ...bullets("Listen for", f.key_points));
      }
    }
  }
  return out.join("\n");
}
