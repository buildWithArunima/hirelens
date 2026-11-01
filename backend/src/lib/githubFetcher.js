// backend/src/lib/githubFetcher.js
// Builds a "snapshot" of a candidate's repo: the file tree, a prioritized set of
// file contents (kept line-accurate so the reviewer can cite line numbers), recent
// commit messages, and a few cheap signals (tests present, .env committed, ...).
// Works with a GitHub URL or a local folder (handy for offline testing).

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const GITHUB_API = "https://api.github.com";

const DEFAULTS = {
  maxFiles: 40,
  maxFileChars: 8000,
  maxTotalChars: 120000,
  maxTreeEntries: 400,
};

// Folders/files that never tell us anything about the candidate's own work.
const IGNORED = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.cache|vendor|venv|\.venv|__pycache__|target)\//,
  /(^|\/)\.git\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock)$/,
  /\.(png|jpe?g|gif|svg|ico|webp|bmp|mp4|mp3|wav|woff2?|ttf|eot|otf|pdf|zip|gz|tar|jar|exe|dll|so|dylib|lock)$/i,
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /(^|\/)\.DS_Store$/,
];

const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|java|go|rb|php|cs|kt|vue|svelte|html|css|scss|sql|prisma|graphql)$/i;
const CONFIG_FILE = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|pom\.xml|build\.gradle|Dockerfile|docker-compose\.ya?ml|\.env\.example|vite\.config\.\w+|tsconfig\.json|\.eslintrc(\.\w+)?|schema\.prisma)$/i;

// Higher score = fetched first. Tuned for typical full-stack intern assignments.
export function scoreFile(filePath, size = 0) {
  if (IGNORED.some(re => re.test(filePath))) return -1;
  const p = filePath.toLowerCase();
  let score = 0;
  if (/(^|\/)readme(\.\w+)?$/.test(p)) score += 150;
  if (/(^|\/)\.env$/.test(p)) score += 90; // committed secrets are worth flagging
  if (CONFIG_FILE.test(filePath)) score += 70;
  if (/(^|\/)(server|app|index|main)\.\w+$/.test(p)) score += 60;
  if (/(^|\/)(routes?|controllers?|api|handlers?)\//.test(p)) score += 50;
  if (/(^|\/)(models?|schemas?|db|database|migrations?)\//.test(p)) score += 45;
  if (/(^|\/)(middlewares?|auth|services?|utils?|lib|hooks)\//.test(p)) score += 35;
  if (/(^|\/)(components?|pages|views|screens|src)\//.test(p)) score += 30;
  if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$/.test(p)) score += 40;
  if (SOURCE_EXT.test(filePath)) score += 20;
  else if (!CONFIG_FILE.test(filePath) && !/readme/.test(p) && !/\.env$/.test(p)) score -= 30;
  score -= filePath.split("/").length * 2; // prefer shallower files
  if (size > 50000) score -= 40; // probably generated or vendored
  return score;
}

export function parseRepoUrl(repoUrl) {
  const match = String(repoUrl).trim().match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?(?:[#?].*)?$/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  const [, owner, repo, branch, subPath] = match;
  return { owner, repo, branch: branch || null, subPath: subPath ? subPath.replace(/\/$/, "") : null };
}

export async function fetchRepoSnapshot(source, options = {}) {
  const { starter: starterSource, ...rest } = options;
  const opts = { ...DEFAULTS, ...rest };
  const starter = starterSource ? await loadStarter(starterSource) : null;
  const snapshot = /github\.com/.test(source) ? await fetchGithubSnapshot(source, opts, starter) : await loadLocalSnapshot(source, opts, starter);
  if (starter?.commitShas) snapshot.commits.forEach(c => { if (starter.commitShas.has(c.sha)) c.fromStarter = true; });
  return snapshot;
}

async function openGithubRepo(repoUrl) {
  const { owner, repo, branch: requestedBranch, subPath } = parseRepoUrl(repoUrl);
  const meta = await githubGet(`/repos/${owner}/${repo}`);
  const branch = requestedBranch || meta.default_branch;
  const treeRes = await githubGet(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);

  let blobs = treeRes.tree.filter(f => f.type === "blob").map(f => ({ path: f.path, size: f.size || 0, sha: f.sha }));
  if (subPath) blobs = blobs.filter(f => f.path.startsWith(subPath + "/"));

  return {
    meta,
    branch,
    blobs,
    prefix: subPath ? subPath + "/" : "",
    commits: perPage => githubGet(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`).catch(() => []),
    read: async p => {
      const res = await githubGet(`/repos/${owner}/${repo}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
      // Buffer (not atob) so UTF-8 survives: atob turns "·" into "Â·".
      return Buffer.from(res.content || "", "base64").toString("utf8");
    },
  };
}

async function fetchGithubSnapshot(repoUrl, opts, starter) {
  const { meta, branch, blobs, prefix, commits: listCommits, read } = await openGithubRepo(repoUrl);

  const commits = (await listCommits(30)).map(c => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0],
    date: c.commit.author?.date,
    author: c.commit.author?.name,
  }));

  const snapshot = await buildSnapshot(blobs, opts, read, starter, prefix);

  return {
    source: repoUrl,
    name: meta.name,
    description: meta.description,
    language: meta.language,
    topics: meta.topics || [],
    branch,
    commits,
    ...snapshot,
  };
}

// Same hash git uses for a blob, so a local folder compares directly with a GitHub tree.
const gitBlobSha = buf => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

async function listLocalBlobs(root, withSha) {
  const blobs = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED.some(re => re.test(relPath + "/"))) await walk(relPath);
      } else if (entry.isFile()) {
        const blob = { path: relPath, size: (await stat(path.join(root, relPath))).size };
        if (withSha) blob.sha = gitBlobSha(await readFile(path.join(root, relPath)));
        blobs.push(blob);
      }
    }
  }
  await walk("");
  return blobs;
}

async function loadLocalSnapshot(dir, opts, starter) {
  const root = path.resolve(dir);
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${dir}`);
  const blobs = await listLocalBlobs(root, Boolean(starter));
  const snapshot = await buildSnapshot(blobs, opts, p => readFile(path.join(root, p), "utf8"), starter);
  return { source: root, name: path.basename(root), description: null, language: null, topics: [], branch: null, commits: [], ...snapshot };
}

// The repo the candidate started from: its file list and SHAs, and a way to read a file on
// demand. Only modified files are ever downloaded from it. Paths are relative to its subfolder.
async function loadStarter(source) {
  try {
    if (/github\.com/.test(source)) {
      const repo = await openGithubRepo(source);
      const commits = await repo.commits(100);
      return {
        source,
        blobs: repo.blobs.map(f => ({ ...f, path: f.path.slice(repo.prefix.length) })),
        read: p => repo.read(repo.prefix + p),
        commitShas: new Set(commits.map(c => c.sha)),
      };
    }
    const root = path.resolve(source);
    if (!(await stat(root)).isDirectory()) throw new Error(`Not a directory: ${source}`);
    return { source: root, blobs: await listLocalBlobs(root, true), read: p => readFile(path.join(root, p), "utf8") };
  } catch (err) {
    throw new Error(`Could not read the starter repo: ${err.message}`);
  }
}

const isVisible = f => !IGNORED.some(re => re.test(f.path));

async function buildSnapshot(blobs, opts, readContent, starter = null, prefix = "") {
  const visible = blobs.filter(isVisible).sort((a, b) => a.path.localeCompare(b.path));
  const changes = starter ? classifyChanges(visible, starter.blobs.filter(isVisible), prefix) : null;
  const changeOf = new Map(changes ? ["added", "modified", "unchanged"].flatMap(kind => changes[kind].map(p => [p, kind])) : []);
  // With a starter, read the candidate's own files first; starter code only fills what's left.
  const tier = f => (changeOf.get(f.path) === "unchanged" ? 1 : 0);
  const ranked = visible
    .map(f => ({ ...f, score: scoreFile(f.path, f.size) }))
    .filter(f => f.score > 0)
    .sort((a, b) => tier(a) - tier(b) || b.score - a.score);

  const files = [];
  const diffs = new Map();
  let totalChars = 0;
  for (const f of ranked) {
    if (files.length >= opts.maxFiles || totalChars >= opts.maxTotalChars) break;
    let content;
    try {
      content = await readContent(f.path);
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue; // binary
    const budget = Math.min(opts.maxFileChars, opts.maxTotalChars - totalChars);
    const truncated = content.length > budget;
    // Cut on a line boundary so cited line numbers stay exact.
    const kept = truncated ? content.slice(0, content.lastIndexOf("\n", budget) + 1 || budget) : content;
    const file = { path: f.path, content: kept, totalLines: content.split("\n").length, truncated };
    if (changes) Object.assign(file, await describeChange(f.path, content, kept));
    files.push(file);
    totalChars += kept.length;
  }

  async function describeChange(filePath, content, kept) {
    const change = changeOf.get(filePath);
    const lineCount = kept.replace(/\n$/, "").split("\n").length;
    if (change === "added") return { change, changedLines: [[1, lineCount]] };
    if (change === "unchanged") return { change, changedLines: [] };
    try {
      const rel = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
      const { changed, removed, removedCount } = diffLines(await starter.read(rel), content);
      const changedLines = clipRanges(changed, lineCount);
      diffs.set(filePath, { changedLines, removed, removedCount });
      return { change, changedLines, removedCount };
    } catch {
      return { change, changedLines: null }; // starter version unreadable: known changed, lines unknown
    }
  }

  const paths = visible.map(f => f.path);
  return {
    tree: paths.slice(0, opts.maxTreeEntries),
    treeTruncated: paths.length > opts.maxTreeEntries,
    totalFiles: paths.length,
    files,
    signals: {
      hasReadme: paths.some(p => /(^|\/)readme(\.\w+)?$/i.test(p)),
      hasTests: paths.some(p => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$/i.test(p)),
      envCommitted: paths.some(p => /(^|\/)\.env$/.test(p)),
      hasEnvExample: paths.some(p => /(^|\/)\.env\.(example|sample)$/i.test(p)),
      hasDockerfile: paths.some(p => /(^|\/)Dockerfile$/.test(p)),
      nodeModulesCommitted: blobs.some(f => /(^|\/)node_modules\//.test(f.path)),
    },
    ...(changes && {
      changes: {
        starter: starter.source,
        ...changes,
        modified: changes.modified.map(p => ({ path: p, changedLines: null, removed: [], removedCount: 0, ...diffs.get(p) })),
      },
    }),
  };
}

async function githubGet(apiPath) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
  const res = await fetch(`${GITHUB_API}${apiPath}`, { headers });
  if (!res.ok) {
    const hint = res.status === 404 ? " (is the repo public?)" : res.status === 403 ? " (rate limited? set GITHUB_TOKEN)" : "";
    throw new Error(`GitHub API error ${res.status} for ${apiPath}${hint}`);
  }
  return res.json();
}

// --- Comparing a candidate's repo with the starter it was built on ---

const MAX_DIFF_CELLS = 4_000_000; // beyond this, treat the middle of the file as rewritten
const MAX_REMOVED_SHOWN = 20;
const MAX_PATHS_SHOWN = 60;

// Sorts candidate files into added / modified / unchanged by git blob SHA.
// `prefix` is the candidate's subfolder (from a /tree/<branch>/<folder> URL).
export function classifyChanges(candidateBlobs, starterBlobs, prefix = "") {
  const starterSha = new Map(starterBlobs.map(f => [f.path, f.sha]));
  const seen = new Set();
  const changes = { added: [], modified: [], unchanged: [], deleted: [] };
  for (const f of candidateBlobs) {
    const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
    seen.add(rel);
    if (!starterSha.has(rel)) changes.added.push(f.path);
    else if (starterSha.get(rel) === f.sha) changes.unchanged.push(f.path);
    else changes.modified.push(f.path);
  }
  changes.deleted = starterBlobs.map(f => f.path).filter(p => !seen.has(p));
  return changes;
}

const toLines = text => {
  const normal = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normal ? normal.split("\n") : [];
};

// Line diff. `changed` holds [start, end] ranges (1-based, inclusive) in the new text;
// `removed` holds the starter lines that are gone, which is how a deleted bug shows up.
export function diffLines(oldText, newText) {
  const a = toLines(oldText), b = toLines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const oldMid = a.slice(head, a.length - tail), newMid = b.slice(head, b.length - tail);
  const changedIdx = [], removedLines = [];
  if ((oldMid.length + 1) * (newMid.length + 1) > MAX_DIFF_CELLS) {
    newMid.forEach((_, j) => changedIdx.push(j));
    removedLines.push(...oldMid);
  } else {
    // Longest common subsequence, walked from the top to list what differs.
    const width = newMid.length + 1;
    const lcs = new Uint16Array((oldMid.length + 1) * width);
    for (let i = oldMid.length - 1; i >= 0; i--) {
      for (let j = newMid.length - 1; j >= 0; j--) {
        lcs[i * width + j] = oldMid[i] === newMid[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < oldMid.length || j < newMid.length) {
      if (i < oldMid.length && j < newMid.length && oldMid[i] === newMid[j]) { i++; j++; }
      else if (j < newMid.length && (i === oldMid.length || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) changedIdx.push(j++);
      else removedLines.push(oldMid[i++]);
    }
  }

  const changed = [];
  for (const idx of changedIdx) {
    const line = head + idx + 1;
    const last = changed[changed.length - 1];
    if (last && last[1] === line - 1) last[1] = line;
    else changed.push([line, line]);
  }
  return { changed, removed: removedLines.slice(0, MAX_REMOVED_SHOWN), removedCount: removedLines.length };
}

const clipRanges = (ranges, lineCount) =>
  ranges.filter(([start]) => start <= lineCount).map(([start, end]) => [start, Math.min(end, lineCount)]);

export const inRanges = (ranges, line) => ranges.some(([start, end]) => line >= start && line <= end);

const formatRanges = ranges => ranges.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(", ");

export function changeCounts(changes) {
  return {
    starter: changes.starter,
    added: changes.added.length,
    modified: changes.modified.length,
    unchanged: changes.unchanged.length,
    deleted: changes.deleted.length,
  };
}

export const hasNoChanges = changes => !changes.added.length && !changes.modified.length && !changes.deleted.length;

// The label after a file's path in a prompt, e.g. "[modified by the candidate, changed lines 3-5]".
export function fileChangeTag(file) {
  if (!file.change) return "";
  if (file.change === "added") return " [added by the candidate]";
  if (file.change === "unchanged") return " [unchanged starter code]";
  const lines = file.changedLines ? (file.changedLines.length ? `changed lines ${formatRanges(file.changedLines)}` : "only removed lines") : "changed lines unknown";
  return ` [modified by the candidate, ${lines}]`;
}

// Plain-text summary for the prompts. The diff is the source of truth for what was done.
export function renderChangeSummary(changes) {
  if (hasNoChanges(changes)) {
    return `Compared with the starter repo (${changes.starter}): the candidate changed NOTHING. Every file is identical to the starter.`;
  }
  const list = paths => {
    const shown = paths.slice(0, MAX_PATHS_SHOWN).map(p => `- ${p}`);
    if (paths.length > MAX_PATHS_SHOWN) shown.push(`- ...and ${paths.length - MAX_PATHS_SHOWN} more`);
    return shown.join("\n");
  };
  const out = [`Compared with the starter repo (${changes.starter}):`];
  if (changes.added.length) out.push(`Added files (${changes.added.length}):\n${list(changes.added)}`);
  if (changes.modified.length) {
    out.push(`Modified files (${changes.modified.length}):\n${changes.modified.map(m => {
      const lines = m.changedLines ? (m.changedLines.length ? `changed lines ${formatRanges(m.changedLines)}` : "no lines added") : "not read, lines unknown";
      const removed = m.removedCount
        ? `\n  removed ${m.removedCount} starter line(s):\n${m.removed.map(l => `    - ${l.trim()}`).join("\n")}${m.removedCount > m.removed.length ? "\n    - ..." : ""}`
        : "";
      return `- ${m.path} (${lines})${removed}`;
    }).join("\n")}`);
  }
  if (changes.deleted.length) out.push(`Files deleted from the starter (${changes.deleted.length}):\n${list(changes.deleted)}`);
  out.push(`Unchanged starter files: ${changes.unchanged.length}`);
  return out.join("\n");
}

// True when a piece of "strength" evidence points only at code the candidate didn't write.
export function citesOnlyStarterCode(ev, file) {
  if (!file?.change || !ev.file || !ev.startLine) return false;
  if (file.change === "unchanged") return true;
  if (file.change !== "modified" || !file.changedLines || file.removedCount) return false;
  const end = ev.endLine || ev.startLine;
  return !file.changedLines.some(([s, e]) => s <= end && e >= ev.startLine);
}
