// Exports (plan.md Flow D): a failure map you can attach to an issue.
// renderSvg mirrors the UI's GraphView from the same shared layout; renderHtml
// wraps it in a single self-contained page (inline CSS, embedded snippets,
// vanilla JS) — no external requests, opens from file://.
import fs from "node:fs";
import path from "node:path";
import { type Layout, MARGIN_X, type PlacedNode, layoutGraph } from "../graph/layout.js";
import type { GraphNode, TraceGraph } from "../graph/types.js";

const TOKENS = {
  bg: "#0b0e1a",
  board: "#0e1222",
  panel: "#111627",
  line: "#272e4c",
  text: "#e8eaf6",
  muted: "#8b93b8",
  faint: "#565e85",
  hot: "#ff4d5e",
  static: "#4a5378",
  ghost: "#b388ff",
  node: "#1a2138",
  nodeEdge: "#39415f",
  chip: "#20263f",
  chipEdge: "#333b5e",
  ok: "#39d98a",
};

const SVG_STYLE = `
  text { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .node-rect { fill: ${TOKENS.node}; stroke: ${TOKENS.nodeEdge}; stroke-width: 1.2; }
  .crash .node-rect { fill: #2a1520; stroke: ${TOKENS.hot}; stroke-width: 1.6; }
  .chip .node-rect { fill: ${TOKENS.chip}; stroke: ${TOKENS.chipEdge}; stroke-dasharray: 4 3; }
  .radius { opacity: .55; }
  .radius .node-rect { fill: #161c31; stroke: #2c3355; }
  .fn { fill: ${TOKENS.text}; font-size: 12px; font-weight: 500; }
  .crash .fn { fill: #ffd7db; }
  .chip .fn { fill: ${TOKENS.muted}; font-size: 11px; font-weight: 400; }
  .radius .fn { fill: #9aa2c6; font-size: 10px; }
  .file { fill: ${TOKENS.muted}; font-size: 9.5px; }
  .radius .file { fill: #5e668d; font-size: 9px; }
  .idx { fill: ${TOKENS.faint}; font-size: 9px; }
  .edge-trace { stroke: ${TOKENS.hot}; stroke-width: 2.2; fill: none; }
  .edge-call, .edge-import { stroke: ${TOKENS.static}; stroke-width: 1.2; fill: none; opacity: .5; }
  .edge-ghost { stroke: ${TOKENS.ghost}; stroke-width: 2; fill: none; stroke-dasharray: 6 5; }
  .ghost-glyph { fill: ${TOKENS.ghost}; font-size: 13px; }
  .ghost-label { fill: ${TOKENS.ghost}; font-size: 9.5px; letter-spacing: .06em; }
  .overflow { fill: ${TOKENS.faint}; font-size: 10px; }
  .connector-line { stroke: ${TOKENS.line}; stroke-dasharray: 2 4; }
  .connector-text { fill: ${TOKENS.muted}; font-size: 11px; letter-spacing: .08em; }
`;

export function renderSvg(graph: TraceGraph): string {
  const layout = layoutGraph(graph);
  const parts: string[] = [];

  for (const e of layout.edges) {
    if (e.kind === "ghost") continue;
    parts.push(`<path class="edge-${e.kind}" d="${e.path}"/>`);
  }
  for (const e of layout.edges.filter((x) => x.kind === "ghost")) {
    parts.push(`<path class="edge-ghost" d="${e.path}"/>`);
    if (e.labelX !== undefined) {
      parts.push(
        `<text class="ghost-glyph" x="${e.labelX - 5}" y="${(e.labelY ?? 0) + 20}">⚡</text>`,
        `<text class="ghost-label" x="${e.labelX}" y="${e.labelY}" text-anchor="middle">${escapeXml(
          e.label ?? "",
        )}</text>`,
      );
    }
  }
  for (const c of layout.connectors) {
    parts.push(
      `<g><line class="connector-line" x1="${c.x}" y1="${c.y}" x2="${layout.width - MARGIN_X}" y2="${c.y}"/>` +
        `<text class="connector-text" x="${c.x}" y="${c.y - 7}">↳ ${escapeXml(c.label)}</text></g>`,
    );
  }
  for (const p of layout.nodes) {
    parts.push(nodeSvg(p));
  }
  for (const o of layout.overflow) {
    parts.push(
      `<text class="overflow" x="${o.x}" y="${o.y}" text-anchor="middle">${escapeXml(o.label)}</text>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}" style="background:${TOKENS.board}">` +
    `<style>${SVG_STYLE}</style>${parts.join("")}</svg>`
  );
}

function nodeSvg(p: PlacedNode): string {
  const { node, x, y, w, h } = p;
  const cx = x + w / 2;
  const isChip = node.kind === "external-chip";
  const isRadius = !node.onSpine;
  const cls = [isChip ? "chip" : "", node.crash ? "crash" : "", isRadius ? "radius" : ""]
    .filter(Boolean)
    .join(" ");
  const rx = isChip ? 16 : isRadius ? 6 : 7;
  const bits = [
    `<rect class="node-rect" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`,
  ];
  if (isRadius) {
    bits.push(
      `<text class="fn" x="${cx}" y="${y + 13}" text-anchor="middle">${escapeXml(truncate(node.name, 14))}</text>`,
      `<text class="file" x="${cx}" y="${y + 25}" text-anchor="middle">${escapeXml(baseName(node.file ?? ""))}</text>`,
    );
  } else if (isChip) {
    bits.push(
      `<text class="fn" x="${cx}" y="${y + h / 2 + 4}" text-anchor="middle">${escapeXml(node.name)}</text>`,
    );
  } else {
    if (node.frameIndex !== undefined) {
      bits.push(`<text class="idx" x="${x + 8}" y="${y + 13}">${node.frameIndex}</text>`);
    }
    const fileLabel = node.file
      ? `${baseName(node.file)}${node.line ? `:${node.line}` : ""}`
      : "unresolved";
    bits.push(
      `<text class="fn" x="${cx}" y="${y + 22}" text-anchor="middle">${escapeXml(truncate(node.name, 15))}</text>`,
      `<text class="file" x="${cx}" y="${y + 37}" text-anchor="middle">${escapeXml(fileLabel)}</text>`,
    );
  }
  return `<g class="${cls}" data-node="${escapeXml(node.id)}">${bits.join("")}</g>`;
}

interface Snippet {
  file: string;
  start: number;
  focus: number;
  lines: string[];
}

export function renderHtml(graph: TraceGraph, repoRoot: string): string {
  const svg = renderSvg(graph);
  const snippets: Record<string, Snippet> = {};
  for (const node of allNodes(graph)) {
    if (!node.file || !node.line) continue;
    try {
      const all = fs.readFileSync(path.join(repoRoot, node.file), "utf8").split("\n");
      const focus = Math.min(Math.max(1, node.line), all.length);
      const start = Math.max(1, focus - 10);
      snippets[node.id] = {
        file: node.file,
        start,
        focus,
        lines: all.slice(start - 1, Math.min(all.length, focus + 10)),
      };
    } catch {
      // file unreadable at export time: node simply has no snippet
    }
  }

  const title = `${graph.exception.type}: ${firstLine(graph.exception.message)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>crashpath — ${escapeXml(title)}</title>
<style>
  body { margin: 0; background: ${TOKENS.bg}; color: ${TOKENS.text};
         font-family: ui-monospace, Menlo, Consolas, monospace; }
  header { display: flex; align-items: center; gap: 14px; padding: 12px 20px;
           border-bottom: 1px solid ${TOKENS.line}; font-size: 14px; }
  header .exc { color: ${TOKENS.hot}; font-weight: 600; }
  header .meta { margin-left: auto; color: ${TOKENS.muted}; font-size: 12px; }
  main { display: flex; }
  .canvas { flex: 1; overflow: auto; }
  aside { width: 340px; flex: none; border-left: 1px solid ${TOKENS.line};
          background: ${TOKENS.panel}; padding: 14px; font-size: 12px;
          min-height: calc(100vh - 60px); }
  aside h2 { font-size: 13px; margin: 0 0 6px; }
  aside .path { color: ${TOKENS.muted}; margin-bottom: 10px; }
  pre { font-size: 11px; line-height: 1.6; overflow-x: auto; }
  .ln { display: flex; }
  .ln .no { width: 40px; text-align: right; padding-right: 10px; color: ${TOKENS.faint}; }
  .ln.hot { background: rgba(255,77,94,.1); box-shadow: inset 3px 0 0 ${TOKENS.hot}; }
  .hint { color: ${TOKENS.faint}; }
  [data-node] { cursor: pointer; }
  footer { padding: 8px 20px; border-top: 1px solid ${TOKENS.line};
           color: ${TOKENS.faint}; font-size: 11px; }
</style>
</head>
<body>
<header>
  <b>crashpath</b>
  <span class="exc">${escapeXml(graph.exception.type)}</span>
  <span>${escapeXml(firstLine(graph.exception.message))}</span>
  <span class="meta">${escapeXml(graph.meta.repo)}${graph.meta.ref ? ` @ ${escapeXml(graph.meta.ref)}` : ""} · ${graph.meta.resolvedFrames}/${graph.meta.totalFrames} frames resolved · exported by crashpath</span>
</header>
<main>
  <div class="canvas">${svg}</div>
  <aside id="panel"><span class="hint">Click a node to see its source.</span></aside>
</main>
<footer>▬ red = runtime trace · ▬ grey = static call/import (parsed) · ⤳ violet dashed = ghost edge (dynamic dispatch) — generated offline, no external requests.</footer>
<script>
var SNIPPETS = ${JSON.stringify(snippets)};
document.querySelectorAll("[data-node]").forEach(function (el) {
  el.addEventListener("click", function () {
    var s = SNIPPETS[el.getAttribute("data-node")];
    var panel = document.getElementById("panel");
    if (!s) { panel.innerHTML = '<span class="hint">No source captured for this node.</span>'; return; }
    var rows = s.lines.map(function (line, i) {
      var no = s.start + i;
      var cls = no === s.focus ? "ln hot" : "ln";
      return '<span class="' + cls + '"><span class="no">' + no + "</span><span>" +
        line.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span></span>";
    }).join("\\n");
    panel.innerHTML = "<h2>" + s.file + ":" + s.focus + "</h2><pre>" + rows + "</pre>";
  });
});
</script>
</body>
</html>
`;
}

function allNodes(graph: TraceGraph): GraphNode[] {
  const nodes = [...graph.nodes];
  for (const c of graph.chained ?? []) nodes.push(...c.graph.nodes);
  return nodes;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseName(p: string): string {
  const segs = p.split("/");
  return segs[segs.length - 1];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return nl === -1 ? s : s.slice(0, nl);
}

/** unused Layout import keeps the shared-layout contract visible to tsc */
export type { Layout };
