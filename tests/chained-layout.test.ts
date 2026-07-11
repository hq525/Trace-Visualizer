import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractTraces } from "../src/extract/index.js";
import { buildGraph } from "../src/graph/build.js";
import { layoutGraph } from "../src/graph/layout.js";
import type { TraceGraph } from "../src/graph/types.js";
import { resolveTrace } from "../src/resolve/index.js";
import { buildRepoIndex } from "../src/resolve/repo.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/traces", import.meta.url));

let root: string;
let graph: TraceGraph;

beforeAll(async () => {
  // fixture 03: ConfigError raised from ValueError → a cause chain. The paths
  // don't exist on disk; unresolved spine nodes are fine for layout purposes.
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-chained-"));
  const text = fs.readFileSync(path.join(FIXTURES, "03-py-chained-cause.txt"), "utf8");
  const trace = extractTraces(text)[0];
  const index = buildRepoIndex(root);
  const { resolved, analyses } = await resolveTrace(trace, index);
  graph = buildGraph(trace, resolved, analyses, { repo: "x", language: "python" });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("chained exceptions (§5.11)", () => {
  it("carries the cause chain on the graph", () => {
    expect(graph.chained).toHaveLength(1);
    expect(graph.chained?.[0].relation).toBe("cause");
    expect(graph.exception.type).toBe("ConfigError");
    expect(graph.chained?.[0].graph.exception.type).toBe("ValueError");
  });

  it("stacks the chained spine below the surfaced one with a labeled connector", () => {
    const layout = layoutGraph(graph);
    expect(layout.connectors).toHaveLength(1);
    expect(layout.connectors[0].label).toBe("caused by");

    const topSpineCount = graph.nodes.filter((n) => n.onSpine).length;
    const spineYs = layout.nodes.map((p) => p.y);
    const topRowY = Math.min(...spineYs.slice(0, topSpineCount));
    const causeRowY = Math.max(...spineYs);
    expect(causeRowY).toBeGreaterThan(topRowY);
    expect(layout.connectors[0].y).toBeGreaterThan(topRowY);
    expect(layout.connectors[0].y).toBeLessThan(causeRowY);

    // both levels' spine nodes are placed
    const chainedCount = graph.chained?.[0].graph.nodes.filter((n) => n.onSpine).length ?? 0;
    expect(layout.nodes).toHaveLength(topSpineCount + chainedCount);
  });
});
