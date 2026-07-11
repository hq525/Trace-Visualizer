// TraceGraph builder (plan.md §5.9): spine nodes with external-chip collapsing,
// runtime trace edges, and §5.6 static call/import edges (unique-match only,
// no type inference). Ghost edges and blast radius land in Phase 3.
import { createHash } from "node:crypto";
import path from "node:path";
import type { FileAnalysis } from "../analyze/types.js";
import type { Frame, ParsedTrace } from "../parsers/types.js";
import type { ResolvedFrame } from "../resolve/index.js";
import { type PathAliases, expandAliases } from "./tsconfig.js";
import type { GraphEdge, GraphNode, TraceGraph } from "./types.js";

export interface BuildMeta {
  repo: string;
  language: string;
  ref?: string;
  /** tsconfig.json#paths aliases, best-effort (§5.4) */
  pathAliases?: PathAliases;
}

export function buildGraph(
  trace: ParsedTrace,
  resolved: ResolvedFrame[],
  analyses: Map<string, FileAnalysis>,
  meta: BuildMeta,
): TraceGraph {
  const levels = flattenChain(trace);
  let offset = 0;
  const levelGraphs = levels.map((t, i) => {
    const slice = resolved.slice(offset, offset + t.frames.length);
    offset += t.frames.length;
    return coreGraph(t, slice, analyses, meta, i === 0);
  });

  const top = levelGraphs[0];
  const chained: NonNullable<TraceGraph["chained"]> = [];
  let cur = trace;
  let k = 1;
  while (cur.chained) {
    chained.push({ relation: cur.chained.relation, graph: levelGraphs[k] });
    cur = cur.chained.trace;
    k++;
  }
  if (chained.length > 0) top.chained = chained;
  top.meta.resolvedFrames = resolved.filter((r) => r.file !== null).length;
  top.meta.totalFrames = resolved.length;
  return top;
}

function flattenChain(trace: ParsedTrace): ParsedTrace[] {
  const out = [trace];
  let cur = trace;
  while (cur.chained) {
    out.push(cur.chained.trace);
    cur = cur.chained.trace;
  }
  return out;
}

function coreGraph(
  trace: ParsedTrace,
  slice: ResolvedFrame[],
  analyses: Map<string, FileAnalysis>,
  meta: BuildMeta,
  isTop: boolean,
): TraceGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byId = new Map<string, GraphNode>();
  const spineIds: string[] = [];

  const push = (node: GraphNode): GraphNode => {
    const existing = byId.get(node.id);
    if (existing) return existing;
    byId.set(node.id, node);
    nodes.push(node);
    return node;
  };

  let i = 0;
  while (i < slice.length) {
    const r = slice[i];
    if (r.frame.isExternal) {
      // collapse the whole consecutive external run into one chip
      const run: ResolvedFrame[] = [];
      while (i < slice.length && slice[i].frame.isExternal) {
        run.push(slice[i]);
        i++;
      }
      const frames = run.map((x) => x.frame);
      const node = push({
        id: `chip:${run[0].frameIndex}`,
        kind: "external-chip",
        name: `${chipLabel(frames)} ×${frames.length}`,
        onSpine: true,
        frameIndex: run[0].frameIndex,
        badges: [],
        collapsedFrames: frames,
      });
      spineIds.push(node.id);
      continue;
    }

    let node: GraphNode;
    if (r.file && r.symbol) {
      node = push({
        id: hashId(r.file, r.symbol.qualifiedName),
        kind: "function",
        name: r.symbol.name,
        qualifiedName: r.symbol.qualifiedName,
        file: r.file,
        span: r.symbol.span,
        onSpine: true,
        frameIndex: r.frameIndex,
        line: r.frame.line ?? undefined,
        badges: [...r.badges],
      });
    } else if (r.file) {
      node = push({
        id: hashId(r.file, "<module>"),
        kind: "file",
        name: basename(r.file),
        file: r.file,
        onSpine: true,
        frameIndex: r.frameIndex,
        line: r.frame.line ?? undefined,
        badges: [...r.badges],
      });
    } else {
      node = push({
        id: `unresolved:${r.frameIndex}`,
        kind: "unresolved",
        name: `${basename(r.frame.rawPath)}${r.frame.line !== null ? `:${r.frame.line}` : ""}`,
        onSpine: true,
        frameIndex: r.frameIndex,
        badges: [...r.badges],
      });
    }
    spineIds.push(node.id);
    i++;
  }

  // runtime trace edges along the spine (recursion may dedupe adjacent ids)
  let t = 0;
  for (let s = 0; s + 1 < spineIds.length; s++) {
    if (spineIds[s] === spineIds[s + 1]) continue;
    edges.push({
      id: `trace:${t++}`,
      from: spineIds[s],
      to: spineIds[s + 1],
      kind: "trace",
      evidence: "runtime",
    });
  }

  if (isTop && spineIds.length > 0) {
    const crash = byId.get(spineIds[spineIds.length - 1]);
    if (crash) crash.crash = true;
  }

  emitStaticCallEdges(byId, analyses, edges, meta.pathAliases ?? {});
  emitGhostEdges(spineIds, byId, analyses, edges);

  return {
    exception: trace.exception,
    nodes,
    edges,
    meta: {
      repo: meta.repo,
      ...(meta.ref ? { ref: meta.ref } : {}),
      resolvedFrames: slice.filter((r) => r.file !== null).length,
      totalFrames: slice.length,
      language: meta.language,
    },
  };
}

/** §5.6: emit a static call edge only when the callee resolves to exactly one
 * candidate among same-file symbols and explicitly imported names — and only
 * when both endpoints are already nodes on this graph. */
function emitStaticCallEdges(
  byId: Map<string, GraphNode>,
  analyses: Map<string, FileAnalysis>,
  edges: GraphEdge[],
  aliases: PathAliases,
): void {
  const fnNode = (file: string, qualifiedName: string): GraphNode | undefined =>
    byId.get(hashId(file, qualifiedName));
  const seen = new Set<string>();
  let c = 0;

  for (const [file, analysis] of analyses) {
    for (const call of analysis.calls) {
      if (!call.enclosing) continue;
      const fromSyms = analysis.symbols.filter(
        (s) => s.kind === "function" && s.name === call.enclosing,
      );
      if (fromSyms.length !== 1) continue;
      const fromNode = fnNode(file, fromSyms[0].qualifiedName);
      if (!fromNode) continue;

      // candidates: same file, then imported names
      const candidates: { file: string; qualifiedName: string }[] = [];
      for (const s of analysis.symbols) {
        if (s.kind === "function" && s.name === call.calleeName) {
          candidates.push({ file, qualifiedName: s.qualifiedName });
        }
      }
      for (const imp of analysis.imports) {
        if (!imp.names.includes(call.calleeName)) continue;
        for (const [otherFile, other] of analyses) {
          if (otherFile === file) continue;
          if (!moduleMatchesFile(imp.module, file, otherFile, aliases)) continue;
          for (const s of other.symbols) {
            if (s.kind === "function" && s.name === call.calleeName) {
              candidates.push({ file: otherFile, qualifiedName: s.qualifiedName });
            }
          }
        }
      }
      if (candidates.length !== 1) continue;
      const toNode = fnNode(candidates[0].file, candidates[0].qualifiedName);
      if (!toNode || toNode.id === fromNode.id) continue;
      const key = `${fromNode.id}->${toNode.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `call:${c++}`,
        from: fromNode.id,
        to: toNode.id,
        kind: "call",
        evidence: "static",
      });
    }
  }
}

/** §5.7 — the flagship. The trace is runtime truth: when consecutive resolved
 * FUNCTION nodes on the spine have no static call edge between them, that hop
 * happened through dynamic dispatch — emit a ghost edge and say why we think
 * so. Pairs involving module-level or unresolved nodes are skipped: we cannot
 * honestly assess static edges there. */
function emitGhostEdges(
  spineIds: string[],
  byId: Map<string, GraphNode>,
  analyses: Map<string, FileAnalysis>,
  edges: GraphEdge[],
): void {
  const spineNodes = spineIds
    .filter((id, i) => i === 0 || id !== spineIds[i - 1])
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined);

  const staticPairs = new Set(
    edges.filter((e) => e.kind === "call" || e.kind === "import").map((e) => `${e.from}->${e.to}`),
  );

  const inRepo = spineNodes.filter((n) => n.kind !== "external-chip");
  let g = 0;
  for (let i = 0; i + 1 < inRepo.length; i++) {
    const a = inRepo[i];
    const b = inRepo[i + 1];
    if (a.kind !== "function" || b.kind !== "function") continue;
    if (staticPairs.has(`${a.id}->${b.id}`)) continue;
    edges.push({
      id: `ghost:${g++}`,
      from: a.id,
      to: b.id,
      kind: "ghost",
      evidence: "runtime",
      ghostHint: ghostHint(a, b, spineNodes, analyses),
    });
  }
}

/** §5.7 hint priority: decorated callee → chip-crossing → dynamic dispatch. */
function ghostHint(
  a: GraphNode,
  b: GraphNode,
  spineNodes: GraphNode[],
  analyses: Map<string, FileAnalysis>,
): string {
  const decorators =
    (b.file &&
      analyses.get(b.file)?.symbols.find((s) => s.qualifiedName === b.qualifiedName)?.decorators) ||
    [];
  if (decorators.length > 0) return `decorator-dispatched (@${decorators[0]})`;

  const ai = spineNodes.findIndex((n) => n.id === a.id);
  const bi = spineNodes.findIndex((n) => n.id === b.id);
  const crossesChip = spineNodes
    .slice(Math.min(ai, bi) + 1, Math.max(ai, bi))
    .some((n) => n.kind === "external-chip");
  if (crossesChip) return "through framework/library";
  return "dynamic dispatch";
}

/** Language-aware import → file matching, best-effort (§5.4, §5.6):
 *  py: "services" → services.py · "pkg.mod" → pkg/mod.py
 *  js: "./util" (relative to the importer) · "@app/fx" via tsconfig paths,
 *      with .ts/.tsx/.js/… and /index.* extension probing. */
function moduleMatchesFile(
  module: string,
  importerFile: string,
  file: string,
  aliases: PathAliases,
): boolean {
  for (const candidate of expandAliases(module, aliases)) {
    if (candidate.startsWith(".") && candidate.includes("/")) {
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(importerFile.split(path.sep).join("/")), candidate),
      );
      if (matchesWithExtensions(base, file)) return true;
    } else if (candidate.startsWith("./") || candidate.startsWith("../")) {
      if (matchesWithExtensions(path.posix.normalize(candidate), file)) return true;
    } else {
      const asPath = candidate.includes("/") ? candidate : candidate.split(".").join("/");
      if (file === `${asPath}.py` || file.endsWith(`/${asPath}.py`)) return true;
      if (matchesWithExtensions(asPath, file)) return true;
    }
  }
  return false;
}

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function matchesWithExtensions(base: string, file: string): boolean {
  for (const ext of JS_EXTENSIONS) {
    if (file === `${base}${ext}` || file.endsWith(`/${base}${ext}`)) return true;
    if (file === `${base}/index${ext}` || file.endsWith(`/${base}/index${ext}`)) return true;
  }
  return false;
}

function chipLabel(frames: Frame[]): string {
  const counts = new Map<string, number>();
  for (const f of frames) {
    const pkg = packageOf(f.rawPath);
    counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
  }
  let best = "external";
  let bestCount = 0;
  for (const [pkg, n] of counts) {
    if (n > bestCount) {
      best = pkg;
      bestCount = n;
    }
  }
  return best;
}

function packageOf(rawPath: string): string {
  const p = rawPath.split("\\").join("/");
  if (p === "<anonymous>" || p === "<elided>" || p === "native") return "native";
  if (p.startsWith("<")) return "python-internals";
  for (const marker of ["/site-packages/", "/dist-packages/", "/node_modules/"]) {
    const at = p.indexOf(marker);
    if (at >= 0) {
      const rest = p.slice(at + marker.length);
      return rest.split("/")[0] || "external";
    }
  }
  const std = p.indexOf("/lib/python3.");
  if (std >= 0) {
    const rest = p.slice(p.indexOf("/", std + "/lib/".length) + 1);
    const seg = rest.split("/");
    return seg.length > 1 ? seg[0] : "stdlib";
  }
  if (p.startsWith("node:")) return "node-internals";
  return "external";
}

function hashId(file: string, qualifiedName: string): string {
  return createHash("sha1").update(`${file}::${qualifiedName}`).digest("hex").slice(0, 12);
}

function basename(p: string): string {
  const segs = p.split("\\").join("/").split("/");
  return segs[segs.length - 1];
}
