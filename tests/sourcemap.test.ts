import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/traces", import.meta.url));
const SPIKE_SRC = fileURLToPath(new URL("../spike/gen/js/src", import.meta.url));

let root: string;
let graph: TraceGraph;

beforeAll(async () => {
  // a repo shaped like the app that produced fixture 27: minified bundle +
  // map in dist/, original TS sources in src/
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-sourcemap-"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.mkdirSync(path.join(root, "src"));
  fs.copyFileSync(
    path.join(FIXTURES, "27-js-minified-sourcemap.bundle.js"),
    path.join(root, "dist/bundle.js"),
  );
  fs.copyFileSync(
    path.join(FIXTURES, "27-js-minified-sourcemap.bundle.js.map"),
    path.join(root, "dist/bundle.js.map"),
  );
  for (const f of ["app.ts", "pricing.ts"]) {
    fs.copyFileSync(path.join(SPIKE_SRC, f), path.join(root, "src", f));
  }

  const text = fs.readFileSync(path.join(FIXTURES, "27-js-minified-sourcemap.txt"), "utf8");
  const result = await runPipeline(text, root);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("sourcemap resolution (§5.3)", () => {
  it("rewrites bundle frames to original TS sources with a via-sourcemap badge", () => {
    const mapped = graph.nodes.filter((n) => n.badges.includes("via-sourcemap"));
    expect(mapped.length).toBeGreaterThanOrEqual(2);
    for (const n of mapped) {
      expect(n.file?.startsWith("src/")).toBe(true);
    }
  });

  it("resolves the crash into the original module, not the bundle", () => {
    const crash = graph.nodes.find((n) => n.crash);
    expect(crash?.file).toBe("src/pricing.ts");
    expect(crash?.badges).toContain("via-sourcemap");
  });

  it("keeps the exception from the minified run", () => {
    expect(graph.exception.type).toBe("RangeError");
  });
});
