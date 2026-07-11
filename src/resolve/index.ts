// Frame → repo file → symbol resolution (plan.md §5.5). Lazy: only files that
// frames land in are read and analyzed; results are memoized per run.
import fs from "node:fs";
import path from "node:path";
import { analyzePythonSource } from "../analyze/python.js";
import type { FileAnalysis, SymbolInfo } from "../analyze/types.js";
import type { Frame, ParsedTrace } from "../parsers/types.js";
import { matchPath, type RepoIndex } from "./repo.js";

export interface ResolvedFrame {
  frame: Frame;
  /** global index across the chained-trace flattening, root-call → crash */
  frameIndex: number;
  /** repo-relative file, null for external/unmatched frames */
  file: string | null;
  /** innermost containing symbol; null for module-level and unresolved frames */
  symbol: SymbolInfo | null;
  badges: string[];
}

const MAX_ANALYZED_FILES = 150;

export async function resolveTrace(
  trace: ParsedTrace,
  index: RepoIndex,
): Promise<{ resolved: ResolvedFrame[]; analyses: Map<string, FileAnalysis> }> {
  const analyses = new Map<string, FileAnalysis>();
  const resolved: ResolvedFrame[] = [];
  let frameIndex = 0;

  for (const t of flattenChain(trace)) {
    for (const frame of t.frames) {
      resolved.push(await resolveFrame(frame, frameIndex, index, analyses));
      frameIndex++;
    }
  }
  return { resolved, analyses };
}

/** Chained traces flattened oldest-cause LAST (spine order: outer trace first). */
function flattenChain(trace: ParsedTrace): ParsedTrace[] {
  const out: ParsedTrace[] = [trace];
  let cur = trace;
  while (cur.chained) {
    out.push(cur.chained.trace);
    cur = cur.chained.trace;
  }
  return out;
}

async function resolveFrame(
  frame: Frame,
  frameIndex: number,
  index: RepoIndex,
  analyses: Map<string, FileAnalysis>,
): Promise<ResolvedFrame> {
  const base: ResolvedFrame = { frame, frameIndex, file: null, symbol: null, badges: [] };
  if (frame.isExternal || frame.line === null) return base;

  const match = matchPath(index, frame.rawPath);
  if (!match.file) return base;
  base.file = match.file;
  if (match.ambiguous) base.badges.push("ambiguous-path");

  const analysis = await analyzeFile(index.root, match.file, analyses);
  if (!analysis || analysis.skipped) return base;

  if (frame.symbol === "<module>" || frame.symbol === undefined) return base;

  const containing = analysis.symbols
    .filter((s) => s.kind === "function" && s.span[0] <= (frame.line as number))
    .filter((s) => (frame.line as number) <= s.span[1])
    .sort((a, b) => b.span[0] - a.span[0]); // innermost first

  const wanted = lastSegment(frame.symbol);
  const inner = containing[0];
  if (inner) {
    if (inner.name === wanted || inner.qualifiedName === frame.symbol) {
      base.symbol = inner;
      return base;
    }
    // line hits a function whose name doesn't match what the trace printed —
    // code has probably drifted since this trace (suggest --ref)
    base.symbol = inner;
    base.badges.push("line-name-mismatch");
    return base;
  }
  // line is outside any function; look the symbol up by name as a fallback
  const byName = analysis.symbols.filter((s) => s.kind === "function" && s.name === wanted);
  if (byName.length === 1) {
    base.symbol = byName[0];
    base.badges.push("line-name-mismatch");
  }
  return base;
}

async function analyzeFile(
  root: string,
  relFile: string,
  analyses: Map<string, FileAnalysis>,
): Promise<FileAnalysis | null> {
  const cached = analyses.get(relFile);
  if (cached) return cached;
  if (analyses.size >= MAX_ANALYZED_FILES) return null;
  if (!relFile.endsWith(".py")) return null;
  let source: string;
  try {
    source = fs.readFileSync(path.join(root, relFile), "utf8");
  } catch {
    return null;
  }
  const analysis = await analyzePythonSource(relFile, source);
  analyses.set(relFile, analysis);
  return analysis;
}

function lastSegment(symbol: string): string {
  // "Class.method" → "method" · "outer.<locals>.inner" → "inner"
  const parts = symbol.split(".");
  return parts[parts.length - 1].replace(/^<locals>$/, parts[parts.length - 1]);
}
