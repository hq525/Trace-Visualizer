// Repo file index + longest-suffix path matching (plan.md §5.5 step 1).
// Trace paths are often absolute paths from another machine; we match them
// against the repo file list by the longest trailing-segment overlap.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface RepoIndex {
  root: string;
  /** posix-style repo-relative paths */
  files: string[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  ".git",
  "__pycache__",
  ".tox",
  ".mypy_cache",
]);
const MAX_FILES = 20_000;

export function buildRepoIndex(root: string): RepoIndex {
  const absRoot = path.resolve(root);
  // --others --exclude-standard: untracked-but-not-ignored files count too —
  // a freshly added source file must still resolve
  const git = spawnSync(
    "git",
    ["-C", absRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (git.status === 0 && git.stdout.length > 0) {
    const files = git.stdout.split("\0").filter((f) => f.length > 0);
    return { root: absRoot, files };
  }
  // fallback: bounded walk
  const files: string[] = [];
  const stack = [absRoot];
  while (stack.length > 0 && files.length < MAX_FILES) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
          stack.push(path.join(dir, e.name));
        }
      } else if (e.isFile()) {
        const rel = path.relative(absRoot, path.join(dir, e.name));
        files.push(rel.split(path.sep).join("/"));
      }
    }
  }
  return { root: absRoot, files };
}

/** Basename-only matches across more than this many files are rejected. */
const MAX_BASENAME_FANOUT = 3;

export function matchPath(
  index: RepoIndex,
  rawPath: string,
): { file: string | null; ambiguous: boolean } {
  const normalized = rawPath
    .replace(/^file:\/\//, "")
    .replace(/^[A-Za-z]:/, "")
    .split("\\")
    .join("/");
  const wanted = normalized.split("/").filter((s) => s.length > 0);
  if (wanted.length === 0) return { file: null, ambiguous: false };

  let bestScore = 0;
  let best: string[] = [];
  for (const file of index.files) {
    const segs = file.split("/");
    let score = 0;
    while (
      score < segs.length &&
      score < wanted.length &&
      segs[segs.length - 1 - score] === wanted[wanted.length - 1 - score]
    ) {
      score++;
    }
    if (score === 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = [file];
    } else if (score === bestScore) {
      best.push(file);
    }
  }

  if (bestScore === 0) return { file: null, ambiguous: false };
  if (bestScore === 1 && best.length > MAX_BASENAME_FANOUT) {
    return { file: null, ambiguous: true };
  }
  if (best.length === 1) return { file: best[0], ambiguous: false };

  // tie-break: fewest path segments (closest to repo root), then lexicographic
  best.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const tieDepth = best[0].split("/").length;
  const stillTied = best.filter((f) => f.split("/").length === tieDepth);
  return { file: best[0], ambiguous: stillTied.length > 1 };
}
