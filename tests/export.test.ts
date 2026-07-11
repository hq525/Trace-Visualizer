import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { renderHtml, renderSvg } from "../src/export/index.js";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));

let graph: TraceGraph;

beforeAll(async () => {
  const text = fs.readFileSync(`${DEMO}/trace.txt`, "utf8");
  const result = await runPipeline(text, DEMO);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
});

describe("exports (Flow D)", () => {
  it("renders an SVG with the spine, ghost edge, and hint label", () => {
    const svg = renderSvg(graph);
    expect(svg).toContain("<svg xmlns=");
    expect(svg).toContain("_lookup_rate");
    expect(svg).toContain("edge-ghost");
    expect(svg).toContain("decorator-dispatched (@pricer)");
  });

  it("renders a fully self-contained HTML file", () => {
    const html = renderHtml(graph, DEMO);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("KeyError");
    // the crash line is embedded as a snippet, readable offline
    expect(html).toContain("return RATES[currency]");
    // self-contained: no external fetches of any kind
    expect(html).not.toMatch(/src\s*=\s*["']https?:/);
    expect(html).not.toMatch(/<link[^>]+href/);
    expect(html).not.toContain("https://");
  });
});
