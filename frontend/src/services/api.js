// src/services/api.js
// The browser only talks to our Express backend. GitHub and model calls (and
// their keys) stay on the server.

export async function analyzeAssignment({ repoUrl, starterUrl, criteria, rubric, resume, interviewMinutes }, accessCode = "") {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(accessCode && { "x-access-code": accessCode }) },
    body: JSON.stringify({ repoUrl, starterUrl, criteria, rubric, resume, interviewMinutes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
