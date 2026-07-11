import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";
import { COL_W, type Layout, layoutGraph } from "../ui/src/layout.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));

let graph: TraceGraph;
let layout: Layout;

beforeAll(async () => {
  const text = fs.readFileSync(`${DEMO}/trace.txt`, "utf8");
  const result = await runPipeline(text, DEMO);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
  layout = layoutGraph(graph);
});

describe("spine layout (pure function, §5.12)", () => {
  it("places every spine node left→right in frameIndex order", () => {
    const spine = layout.nodes.filter((p) => p.node.onSpine);
    expect(spine.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < spine.length; i++) {
      expect(spine[i].x).toBeGreaterThan(spine[i - 1].x);
      expect(spine[i].node.frameIndex ?? 0).toBeGreaterThan(spine[i - 1].node.frameIndex ?? 0);
    }
    expect(spine[1].x - spine[0].x).toBe(COL_W);
  });

  it("keeps chips and the crash node on the spine", () => {
    expect(layout.nodes.some((p) => p.node.kind === "external-chip")).toBe(true);
    const crash = layout.nodes.find((p) => p.node.crash);
    expect(crash).toBeDefined();
    const maxX = Math.max(...layout.nodes.map((p) => p.x));
    expect(crash?.x).toBe(maxX);
  });

  it("routes one trace edge between each consecutive spine pair", () => {
    const spineCount = layout.nodes.filter((p) => p.node.onSpine).length;
    const traceEdges = layout.edges.filter((e) => e.kind === "trace");
    expect(traceEdges).toHaveLength(spineCount - 1);
    for (const e of traceEdges) expect(e.path).toMatch(/^M /);
  });

  it("reports a canvas size that contains all nodes", () => {
    for (const p of layout.nodes) {
      expect(p.x + p.w).toBeLessThanOrEqual(layout.width);
      expect(p.y + p.h).toBeLessThanOrEqual(layout.height);
    }
  });
});
