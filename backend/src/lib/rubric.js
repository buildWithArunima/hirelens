// backend/src/lib/rubric.js
// Turns whatever the interviewer pastes (JSON or plain text) into rubric items,
// and owns the rating scale so points are computed in code, not by the model.

// Lenient, intern-level scale. "meets" is the bar for a good intern: it works and
// the approach is reasonable, even if it is not production-grade.
export const RATINGS = {
  strong:  { fraction: 1.0,  label: "Strong",          meaning: "Above the intern bar: works well and shows care beyond the minimum (clean structure, edge cases, tests, thoughtful UX)." },
  meets:   { fraction: 0.75, label: "Meets intern bar", meaning: "Works for the main flow with a reasonable approach. Rough edges and non-production choices are fine." },
  partial: { fraction: 0.5,  label: "Partially meets", meaning: "Attempted and partly working, or works but with notable gaps an intern should be coached on." },
  minimal: { fraction: 0.25, label: "Minimal",         meaning: "Only a token attempt, or mostly broken." },
  missing: { fraction: 0,    label: "Not found",       meaning: "No evidence in the code that this was attempted." },
  not_assessable: { fraction: null, label: "Can't assess", meaning: "The fetched code isn't enough to judge (file not fetched, needs running the app). Excluded from the total." },
};

const DEFAULT_POINTS = 10;

// Accepts:
//  - an array of {criterion|name|title, description?, maxPoints|points|weight?}
//  - a JSON string of that array (or {items:[...]})
//  - plain text, one item per line, e.g. "- Code quality (20 pts): readable, modular"
export function normalizeRubric(input) {
  if (!input || (typeof input === "string" && !input.trim())) {
    throw new Error("A rubric is required");
  }
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { items: parseTextRubric(raw), rawText: raw };
    }
  }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.items)) raw = raw.items;
  if (!Array.isArray(raw)) throw new Error("Rubric JSON must be an array of items");
  const items = raw.map((it, i) => {
    const criterion = it.criterion || it.name || it.title;
    if (!criterion) throw new Error(`Rubric item ${i + 1} has no name`);
    const pts = Number(it.maxPoints ?? it.points ?? it.weight);
    return {
      id: `R${i + 1}`,
      criterion: String(criterion).trim(),
      description: (it.description || it.details || "").trim(),
      maxPoints: Number.isFinite(pts) && pts > 0 ? pts : DEFAULT_POINTS,
    };
  });
  return { items, rawText: null };
}

function parseTextRubric(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const isItem = /^([-*•]|\d+[.)])\s+/.test(line) || /\(\s*\d+(\.\d+)?\s*(pts?|points?|marks?|%)\s*\)/i.test(line);
    const body = line.replace(/^([-*•]|\d+[.)])\s+/, "");
    if (!isItem) {
      // Continuation line: attach to the previous item's description.
      if (items.length && !/^#/.test(line)) items[items.length - 1].description += (items[items.length - 1].description ? " " : "") + line;
      continue;
    }
    const pts = body.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?|%)\s*\)?/i);
    const withoutPts = pts ? body.replace(pts[0], "").trim() : body;
    const [name, ...rest] = withoutPts.split(/\s*[:–—]\s+|\s+-\s+/);
    items.push({
      id: `R${items.length + 1}`,
      criterion: name.replace(/[:\-–—]\s*$/, "").replace(/\*\*/g, "").trim(),
      description: rest.join(" - ").trim(),
      maxPoints: pts ? Number(pts[1]) : DEFAULT_POINTS,
    });
  }
  if (!items.length) {
    // No list structure at all: treat each non-empty line as an item.
    return lines.map((l, i) => ({ id: `R${i + 1}`, criterion: l, description: "", maxPoints: DEFAULT_POINTS }));
  }
  return items;
}

export function pointsFor(rating, maxPoints) {
  const r = RATINGS[rating];
  if (!r || r.fraction === null) return null;
  return Math.round(maxPoints * r.fraction * 10) / 10;
}

// Lenient bands for an early round: "advance" means worth a conversation.
export function recommendationFor(percent) {
  if (percent === null) return { key: "insufficient_evidence", label: "Not enough evidence to score" };
  if (percent >= 80) return { key: "strong_advance", label: "Strong advance" };
  if (percent >= 60) return { key: "advance", label: "Advance" };
  if (percent >= 45) return { key: "borderline", label: "Borderline: decide in the interview" };
  return { key: "do_not_advance", label: "Below the intern bar" };
}
