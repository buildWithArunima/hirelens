// backend/src/lib/evidence.js
// Checks every piece of evidence the model cites against the code we actually
// sent it, so a new interviewer never repeats a hallucinated line in the call.

const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const SLACK = 3; // models are often off by a line or two

export function verifyEvidence(ev, snapshot) {
  const result = {
    file: ev.file || null,
    startLine: toInt(ev.startLine),
    endLine: toInt(ev.endLine),
    quote: ev.quote || "",
    kind: ev.kind === "gap" ? "gap" : "strength",
    note: ev.note || "",
    status: "unverified",
    snippet: null,
  };

  if (!result.file) {
    // Evidence of absence ("no tests anywhere") has nothing to point at.
    result.status = result.kind === "gap" ? "absence" : "unverified";
    return result;
  }

  const file = snapshot.files.find(f => f.path === result.file)
    || snapshot.files.find(f => f.path.endsWith("/" + result.file) || result.file.endsWith("/" + f.path));
  if (!file) {
    result.status = snapshot.tree.includes(result.file) ? "file_not_fetched" : "file_not_found";
    return result;
  }
  result.file = file.path;

  const lines = file.content.replace(/\n$/, "").split("\n");
  const quote = norm(result.quote);
  let start = clamp(result.startLine ?? 1, 1, lines.length);
  let end = clamp(result.endLine ?? start, start, lines.length);

  if (quote) {
    const inRange = idx => idx + 1 >= start - SLACK && idx + 1 <= end + SLACK;
    const hits = lines.map((l, i) => (norm(l).includes(quote) || (norm(l).length > 8 && quote.includes(norm(l))) ? i : -1)).filter(i => i >= 0);
    const near = hits.find(inRange);
    if (near !== undefined) {
      result.status = "verified";
      if (near + 1 < start || near + 1 > end) {
        // Re-anchor the range on the quoted line.
        const span = end - start;
        start = near + 1;
        end = clamp(start + span, start, lines.length);
      }
    } else if (hits.length) {
      result.status = "line_mismatch"; // quote exists, but elsewhere in the file
      const span = end - start;
      start = hits[0] + 1;
      end = clamp(start + span, start, lines.length);
    } else {
      result.status = "quote_not_found";
    }
  } else {
    result.status = result.startLine ? "lines_only" : "file_only";
  }

  result.startLine = start;
  result.endLine = Math.min(end, start + 14); // keep snippets short in the report
  result.snippet = lines.slice(result.startLine - 1, result.endLine).join("\n");
  return result;
}

export const TRUSTED_STATUSES = new Set(["verified", "line_mismatch", "absence"]);

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
