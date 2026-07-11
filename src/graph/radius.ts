// Blast radius discovery (plan.md §5.8): 1-hop callers and callees of spine
// functions. Callees come from analyzing 1 level of imports (§5.4b); callers
// from `git grep -nwF` (fallback: bounded scan of indexed files). This stage
// touches fs/git, so it lives outside the pure graph builder — it only
// DISCOVERS nodes; the §5.6 static-edge pass wires them.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FileAnalysis } from "../analyze/types.js";
import { type ResolvedFrame, analyzeRepoFile } from "../resolve/index.js";
import type { RepoIndex } from "../resolve/repo.js";
import { moduleMatchesFile, resolveUniqueCallTarget } from "./build.js";
import type { PathAliases } from "./tsconfig.js";
import type { RadiusCandidate } from "./types.js";

/** §5.8: too-generic names produce noise, not signal. */
const STOPLIST = new Set([
  "get",
  "run",
  "main",
  "init",
  "handler",
  "process",
  "update",
  "create",
  "delete",
]);
const MIN_SYMBOL_LENGTH = 4;
const MAX_CALLER_FILES_PER_SYMBOL = 40;
const MAX_FALLBACK_SCAN_HITS = 200;
const CODE_FILE = /\.(py|ts|tsx|js|jsx|mjs|cjs)$/;

export async function collectRadius(
  resolved: ResolvedFrame[],
  index: RepoIndex,
  analyses: Map<string, FileAnalysis>,
  aliases: PathAliases,
): Promise<RadiusCandidate[]> {
  const spine = resolved.filter(
    (r): r is ResolvedFrame & { file: string } => r.file !== null && r.symbol !== null,
  );
  const spineKeys = new Set(spine.map((r) => `${r.file}::${r.symbol?.qualifiedName}`));
  const out: RadiusCandidate[] = [];
  const outKeys = new Set<string>();
  const add = (candidate: RadiusCandidate): void => {
    const key = `${candidate.file}::${candidate.symbol.qualifiedName}`;
    if (spineKeys.has(key) || outKeys.has(key)) return;
    outKeys.add(key);
    out.push(candidate);
  };

  // analyze 1 level of imports from spine files so callee targets resolve
  for (const r of spine) {
    const analysis = analyses.get(r.file);
    if (!analysis) continue;
    for (const imp of analysis.imports) {
      for (const file of index.files) {
        if (analyses.has(file) || !CODE_FILE.test(file)) continue;
        if (moduleMatchesFile(imp.module, r.file, file, aliases)) {
          await analyzeRepoFile(index.root, file, analyses);
        }
      }
    }
  }

  // callees: unique-resolved call targets out of spine functions
  for (const r of spine) {
    const analysis = analyses.get(r.file);
    if (!analysis) continue;
    for (const call of analysis.calls) {
      if (call.enclosing !== r.symbol?.name) continue;
      const target = resolveUniqueCallTarget(call, r.file, analyses, aliases);
      if (target) add({ file: target.file, symbol: target.symbol, direction: "callee" });
    }
  }

  // callers: word-grep per spine symbol, then keep unique resolutions back to it
  for (const r of spine) {
    const name = r.symbol?.name ?? "";
    if (name.length < MIN_SYMBOL_LENGTH || STOPLIST.has(name)) continue;
    for (const file of grepFiles(index, name).slice(0, MAX_CALLER_FILES_PER_SYMBOL)) {
      if (!CODE_FILE.test(file)) continue;
      await analyzeRepoFile(index.root, file, analyses);
      const analysis = analyses.get(file);
      if (!analysis) continue;
      for (const call of analysis.calls) {
        if (call.calleeName !== name || !call.enclosing) continue;
        const target = resolveUniqueCallTarget(call, file, analyses, aliases);
        if (!target) continue;
        if (
          `${target.file}::${target.symbol.qualifiedName}` !==
          `${r.file}::${r.symbol?.qualifiedName}`
        )
          continue;
        const callers = analysis.symbols.filter(
          (s) => s.kind === "function" && s.name === call.enclosing,
        );
        if (callers.length === 1) add({ file, symbol: callers[0], direction: "caller" });
      }
    }
  }

  return out;
}

function grepFiles(index: RepoIndex, name: string): string[] {
  try {
    const stdout = execFileSync("git", ["-C", index.root, "grep", "-lwF", "-e", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return stdout.split("\n").filter((f) => f.length > 0);
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    if (e.status === 1 && `${e.stderr ?? ""}`.trim() === "") return []; // no matches
    // not a git repo (or git missing): bounded scan over the indexed files
    const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    const hits: string[] = [];
    for (const file of index.files) {
      if (hits.length >= MAX_FALLBACK_SCAN_HITS) break;
      if (!CODE_FILE.test(file)) continue;
      try {
        if (word.test(fs.readFileSync(path.join(index.root, file), "utf8"))) hits.push(file);
      } catch {
        // unreadable file: skip
      }
    }
    return hits;
  }
}
