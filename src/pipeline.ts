// Composition root: dirty text + repo root → TraceGraph, or a typed failure
// matching the CLI exit-code contract (§3.2).
import path from "node:path";
import { SEARCHED_ANCHORS, extractTraces } from "./extract/index.js";
import { buildGraph } from "./graph/build.js";
import type { TraceGraph } from "./graph/types.js";
import { resolveTrace } from "./resolve/index.js";
import { buildRepoIndex } from "./resolve/repo.js";
import { applySourcemaps } from "./sourcemap/index.js";

export type PipelineResult =
  | { ok: true; graph: TraceGraph }
  | { ok: false; exitCode: 2 | 3; message: string };

export async function runPipeline(text: string, repoRoot: string): Promise<PipelineResult> {
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
  const trace = traces[0]; // multi-trace picker arrives in Phase 2 (§5.1.4)

  const index = buildRepoIndex(repoRoot);
  await applySourcemaps(trace, index); // §5.3: rewrite generated-file frames in place
  const { resolved, analyses } = await resolveTrace(trace, index);
  const graph = buildGraph(trace, resolved, analyses, {
    repo: path.basename(path.resolve(repoRoot)),
    language: trace.language,
  });

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
