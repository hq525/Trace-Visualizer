import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractTraces } from "../src/extract/index.js";
import { buildGraph } from "../src/graph/build.js";
import type { TraceGraph } from "../src/graph/types.js";
import { resolveTrace } from "../src/resolve/index.js";
import { buildRepoIndex } from "../src/resolve/repo.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));

let graph: TraceGraph;

beforeAll(async () => {
  const text = fs.readFileSync(`${DEMO}/trace.txt`, "utf8");
  const trace = extractTraces(text)[0];
  const index = buildRepoIndex(DEMO);
  const { resolved, analyses } = await resolveTrace(trace, index);
  graph = buildGraph(trace, resolved, analyses, { repo: "shop", language: trace.language });
});

describe("trace graph builder (§5.9)", () => {
  it("marks the last spine node as the crash with the right symbol", () => {
    const spine = graph.nodes.filter((n) => n.onSpine);
    const crash = spine[spine.length - 1];
    expect(crash.crash).toBe(true);
    expect(crash.name).toBe("_lookup_rate");
    expect(crash.file).toBe("fx.py");
  });

  it("collapses consecutive external frames into chips", () => {
    const chips = graph.nodes.filter((n) => n.kind === "external-chip");
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(chips[0].collapsedFrames?.length).toBeGreaterThanOrEqual(2);
    expect(chips[0].onSpine).toBe(true);
  });

  it("keeps the five app frames as resolved function nodes in spine order", () => {
    const fns = graph.nodes.filter((n) => n.onSpine && n.kind === "function");
    const names = fns.map((n) => n.name);
    expect(names).toEqual([
      "read_product",
      "build_quote",
      "price_with_tax",
      "convert",
      "_lookup_rate",
    ]);
    const idx = fns.map((n) => n.frameIndex ?? -1);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("connects every consecutive spine pair with a runtime trace edge", () => {
    const spine = graph.nodes.filter((n) => n.onSpine);
    const traceEdges = graph.edges.filter((e) => e.kind === "trace");
    expect(traceEdges).toHaveLength(spine.length - 1);
    for (const e of traceEdges) expect(e.evidence).toBe("runtime");
  });

  it("emits static call edges between analyzed app functions", () => {
    const call = graph.edges.filter((e) => e.kind === "call");
    // read_product → price_with_tax and price_with_tax → get_product are
    // unique name-resolvable within the analyzed files
    expect(call.length).toBeGreaterThanOrEqual(2);
    for (const e of call) expect(e.evidence).toBe("static");
  });

  it("counts resolution in meta", () => {
    expect(graph.meta.language).toBe("python");
    expect(graph.meta.resolvedFrames).toBeGreaterThanOrEqual(3);
    expect(graph.meta.totalFrames).toBeGreaterThan(10);
  });

  it("round-trips through JSON (the --json contract)", () => {
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });
});
