// Composition root: dirty text + repo root → TraceGraph, or a typed failure
// matching the CLI exit-code contract (§3.2).
import path from "node:path";
import { SEARCHED_ANCHORS, extractTraces } from "./extract/index.js";
import { buildGraph } from "./graph/build.js";
import { collectRadius } from "./graph/radius.js";
import { loadTsconfigPaths } from "./graph/tsconfig.js";
import type { TraceGraph } from "./graph/types.js";
import { resolveTrace } from "./resolve/index.js";
import { buildRepoIndex } from "./resolve/repo.js";
import { applySourcemaps } from "./sourcemap/index.js";

export type PipelineResult =
  | { ok: true; graph: TraceGraph }
  | { ok: false; exitCode: 2 | 3; message: string };

export interface TraceSummary {
  /** index into the extracted-trace list — pass as `pick` */
  index: number;
  language: string;
  exceptionType: string;
  message: string;
  frameCount: number;
  /** identical signatures deduped into one entry (§5.1.4) */
  count: number;
}

/** Distinct traces in a blob, deduped by exception signature (§5.1.4). */
export function listTraces(text: string): TraceSummary[] {
  const traces = extractTraces(text);
  const bySignature = new Map<string, TraceSummary>();
  traces.forEach((trace, index) => {
    const crash = trace.frames[trace.frames.length - 1];
    const signature = `${trace.language}:${trace.exception.type}:${crash?.rawPath ?? ""}:${crash?.line ?? ""}`;
    const existing = bySignature.get(signature);
    if (existing) {
      existing.count++;
      return;
    }
    bySignature.set(signature, {
      index,
      language: trace.language,
      exceptionType: trace.exception.type,
      message: firstLine(trace.exception.message),
      frameCount: trace.frames.length,
      count: 1,
    });
  });
  return [...bySignature.values()];
}

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return nl === -1 ? s : s.slice(0, nl);
}

export async function runPipeline(
  text: string,
  repoRoot: string,
  options: { pick?: number; repoLabel?: string } = {},
): Promise<PipelineResult> {
  const traces = extractTraces(text);
  if (traces.length === 0) {
    return {
      ok: false,
      exitCode: 2,
      message: `No stack trace found in the input.\nSearched for these anchors:\n  - ${SEARCHED_ANCHORS.join(
        "\n  - ",
      )}\nIf your trace is in an unusual format, please file it as an issue — it becomes a fixture.`,
    };
  }
  const trace = traces[options.pick ?? 0] ?? traces[0];

  const index = buildRepoIndex(repoRoot);
  await applySourcemaps(trace, index); // §5.3: rewrite generated-file frames in place
  const { resolved, analyses } = await resolveTrace(trace, index);
  const pathAliases = loadTsconfigPaths(path.resolve(repoRoot));
  const radius = await collectRadius(resolved, index, analyses, pathAliases); // §5.8
  const graph = buildGraph(
    trace,
    resolved,
    analyses,
    {
      repo: options.repoLabel ?? path.basename(path.resolve(repoRoot)),
      language: trace.language,
      pathAliases,
    },
    radius,
  );

  if (graph.meta.resolvedFrames === 0) {
    const unresolvedPaths = [
      ...new Set(
        resolved.filter((r) => !r.frame.isExternal && r.file === null).map((r) => r.frame.rawPath),
      ),
    ].slice(0, 5);
    return {
      ok: false,
      exitCode: 3,
      message: `No frames resolved to files under ${path.resolve(repoRoot)} — likely the wrong --repo.\nTop unresolved paths:\n  - ${unresolvedPaths.join(
        "\n  - ",
      )}`,
    };
  }
  return { ok: true, graph };
}
