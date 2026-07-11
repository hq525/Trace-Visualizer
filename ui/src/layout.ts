// Deterministic spine layout (plan.md §5.12). Pure function: graph → placed
// nodes + routed edges. No layout engine, no randomness — stable GIFs, stable
// tests. Blast radius / chained spines arrive in Phase 3.
import type { GraphEdge, GraphNode, TraceGraph } from "../../src/graph/types.js";

export const COL_W = 125;
export const NODE_W = 108;
export const NODE_H = 46;
export const CHIP_H = 32;
export const MARGIN_X = 50;
export const SPINE_Y = 120;
export const CANVAS_H = 290;

export interface PlacedNode {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge {
  id: string;
  kind: GraphEdge["kind"];
  /** svg path data */
  path: string;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

export function layoutGraph(graph: TraceGraph): Layout {
  const spine = graph.nodes
    .filter((n) => n.onSpine)
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));

  const placed = new Map<string, PlacedNode>();
  const nodes: PlacedNode[] = spine.map((node, i) => {
    const isChip = node.kind === "external-chip";
    const h = isChip ? CHIP_H : NODE_H;
    const p: PlacedNode = {
      node,
      x: MARGIN_X + i * COL_W,
      y: SPINE_Y + (isChip ? (NODE_H - CHIP_H) / 2 : 0),
      w: NODE_W,
      h,
    };
    placed.set(node.id, p);
    return p;
  });

  const edges: PlacedEdge[] = [];
  for (const e of graph.edges) {
    const from = placed.get(e.from);
    const to = placed.get(e.to);
    if (!from || !to) continue;
    if (e.kind === "trace") {
      const y = SPINE_Y + NODE_H / 2;
      edges.push({ id: e.id, kind: e.kind, path: `M ${from.x + from.w} ${y} L ${to.x} ${y}` });
    } else {
      // static context edges arc under the spine
      const y0 = from.y + from.h;
      const y1 = to.y + to.h;
      const midX = (from.x + from.w / 2 + to.x + to.w / 2) / 2;
      const dip = SPINE_Y + NODE_H + 46;
      edges.push({
        id: e.id,
        kind: e.kind,
        path: `M ${from.x + from.w / 2} ${y0} Q ${midX} ${dip} ${to.x + to.w / 2} ${y1}`,
      });
    }
  }

  return {
    nodes,
    edges,
    width: MARGIN_X * 2 + Math.max(spine.length - 1, 0) * COL_W + NODE_W,
    height: CANVAS_H,
  };
}
