// Deterministic spine layout (plan.md §5.12). Pure function: graph → placed
// nodes + routed edges. No layout engine, no randomness — stable GIFs, stable
// tests. Radius nodes stack above (callers) / below (callees) their anchor
// column, nearest-first, with "+N more" overflow markers.
import type { GraphEdge, GraphNode, TraceGraph } from "../../src/graph/types.js";

export const COL_W = 125;
export const NODE_W = 108;
export const NODE_H = 46;
export const CHIP_H = 32;
export const RADIUS_W = 96;
export const RADIUS_H = 32;
export const MARGIN_X = 50;
const ROW_STEP = 64;
const RADIUS_GAP = 26;
const HEAD_ROOM = 120; // ghost arcs + labels need air above the spine
const MAX_RADIUS_ROWS = 2;

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
  fromId: string;
  toId: string;
  /** svg path data */
  path: string;
  /** ghost edges: §5.7 hint, rendered near the arc apex */
  label?: string;
  labelX?: number;
  labelY?: number;
}

export interface OverflowMarker {
  x: number;
  y: number;
  label: string;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  overflow: OverflowMarker[];
  width: number;
  height: number;
}

export function layoutGraph(graph: TraceGraph): Layout {
  const spine = graph.nodes
    .filter((n) => n.onSpine)
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
  const radius = graph.nodes.filter((n) => !n.onSpine);

  // radius rows above dictate how far down the spine sits
  const { anchors, aboveRows, belowRows, overflowCounts } = assignRadius(graph, radius);
  const spineY = Math.max(HEAD_ROOM, 46 + aboveRows * ROW_STEP + (aboveRows > 0 ? RADIUS_GAP : 0));

  const placed = new Map<string, PlacedNode>();
  const nodes: PlacedNode[] = spine.map((node, i) => {
    const isChip = node.kind === "external-chip";
    const h = isChip ? CHIP_H : NODE_H;
    const p: PlacedNode = {
      node,
      x: MARGIN_X + i * COL_W,
      y: spineY + (isChip ? (NODE_H - CHIP_H) / 2 : 0),
      w: NODE_W,
      h,
    };
    placed.set(node.id, p);
    return p;
  });

  // radius nodes: centered on the anchor's column
  for (const a of anchors) {
    const anchorPlaced = placed.get(a.anchorId);
    if (!anchorPlaced) continue;
    const x = anchorPlaced.x + (NODE_W - RADIUS_W) / 2;
    const y =
      a.direction === "caller"
        ? spineY - RADIUS_GAP - RADIUS_H - a.row * ROW_STEP
        : spineY + NODE_H + RADIUS_GAP + a.row * ROW_STEP;
    const p: PlacedNode = { node: a.node, x, y, w: RADIUS_W, h: RADIUS_H };
    placed.set(a.node.id, p);
    nodes.push(p);
  }

  const edges: PlacedEdge[] = [];
  for (const e of graph.edges) {
    const from = placed.get(e.from);
    const to = placed.get(e.to);
    if (!from || !to) continue;
    const base = { id: e.id, kind: e.kind, fromId: e.from, toId: e.to };
    if (e.kind === "trace") {
      const y = spineY + NODE_H / 2;
      edges.push({ ...base, path: `M ${from.x + from.w} ${y} L ${to.x} ${y}` });
    } else if (e.kind === "ghost") {
      // dynamic-dispatch hop: dashed arc above the spine (§5.7)
      const fx = from.x + from.w / 2;
      const tx = to.x + to.w / 2;
      const midX = (fx + tx) / 2;
      const rise = Math.min(from.y, to.y) - 42;
      edges.push({
        ...base,
        path: `M ${fx} ${from.y} Q ${midX} ${rise} ${tx} ${to.y}`,
        label: e.ghostHint,
        labelX: midX,
        labelY: rise - 6,
      });
    } else if (!from.node.onSpine || !to.node.onSpine) {
      // radius link: near-vertical connector between column neighbours
      const [spineEnd, radiusEnd] = from.node.onSpine ? [from, to] : [to, from];
      const above = radiusEnd.y < spineEnd.y;
      const x0 = spineEnd.x + spineEnd.w / 2;
      const y0 = above ? spineEnd.y : spineEnd.y + spineEnd.h;
      const x1 = radiusEnd.x + radiusEnd.w / 2;
      const y1 = above ? radiusEnd.y + radiusEnd.h : radiusEnd.y;
      edges.push({
        ...base,
        path: `M ${x0} ${y0} Q ${(x0 + x1) / 2} ${(y0 + y1) / 2} ${x1} ${y1}`,
      });
    } else {
      // static context edges arc under the spine
      const y0 = from.y + from.h;
      const y1 = to.y + to.h;
      const midX = (from.x + from.w / 2 + to.x + to.w / 2) / 2;
      const dip = spineY + NODE_H + 46;
      edges.push({
        ...base,
        path: `M ${from.x + from.w / 2} ${y0} Q ${midX} ${dip} ${to.x + to.w / 2} ${y1}`,
      });
    }
  }

  const overflow: OverflowMarker[] = [];
  for (const [key, count] of overflowCounts) {
    const [anchorId, direction] = key.split("|");
    const anchorPlaced = placed.get(anchorId);
    if (!anchorPlaced) continue;
    overflow.push({
      x: anchorPlaced.x + NODE_W / 2,
      y:
        direction === "caller"
          ? spineY - RADIUS_GAP - MAX_RADIUS_ROWS * ROW_STEP + 8
          : spineY + NODE_H + RADIUS_GAP + MAX_RADIUS_ROWS * ROW_STEP + 8,
      label: `+${count} more`,
    });
  }

  const height = spineY + NODE_H + (belowRows > 0 ? RADIUS_GAP + belowRows * ROW_STEP : 0) + 110;
  return {
    nodes,
    edges,
    overflow,
    width: MARGIN_X * 2 + Math.max(spine.length - 1, 0) * COL_W + NODE_W,
    height,
  };
}

interface RadiusAnchor {
  node: GraphNode;
  anchorId: string;
  direction: "caller" | "callee";
  row: number;
}

function assignRadius(
  graph: TraceGraph,
  radius: GraphNode[],
): {
  anchors: RadiusAnchor[];
  aboveRows: number;
  belowRows: number;
  overflowCounts: Map<string, number>;
} {
  const spineIds = new Set(graph.nodes.filter((n) => n.onSpine).map((n) => n.id));
  const anchors: RadiusAnchor[] = [];
  const rowCounters = new Map<string, number>();
  const overflowCounts = new Map<string, number>();
  let aboveRows = 0;
  let belowRows = 0;

  for (const node of radius) {
    const link = graph.edges.find(
      (e) =>
        (e.from === node.id && spineIds.has(e.to)) || (e.to === node.id && spineIds.has(e.from)),
    );
    if (!link) continue; // unlinked radius nodes are not rendered
    const direction: "caller" | "callee" = link.from === node.id ? "caller" : "callee";
    const anchorId = link.from === node.id ? link.to : link.from;
    const key = `${anchorId}|${direction}`;
    const row = rowCounters.get(key) ?? 0;
    if (row >= MAX_RADIUS_ROWS) {
      overflowCounts.set(key, (overflowCounts.get(key) ?? 0) + 1);
      continue;
    }
    rowCounters.set(key, row + 1);
    anchors.push({ node, anchorId, direction, row });
    if (direction === "caller") aboveRows = Math.max(aboveRows, row + 1);
    else belowRows = Math.max(belowRows, row + 1);
  }
  return { anchors, aboveRows, belowRows, overflowCounts };
}
