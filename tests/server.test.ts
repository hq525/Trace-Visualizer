import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src/server/index.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));
const TRACE = fs.readFileSync(path.join(DEMO, "trace.txt"), "utf8");

let server: RunningServer;
let base: string;

beforeAll(async () => {
  server = await startServer({ repoRoot: DEMO, port: 0 });
  base = server.url;
});

afterAll(async () => {
  await server.close();
});

describe("local server (§5.13)", () => {
  it("binds to 127.0.0.1", () => {
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("404s /api/graph before any trace is loaded", async () => {
    const res = await fetch(`${base}/api/graph`);
    expect(res.status).toBe(404);
  });

  it("POST /api/trace runs the pipeline and stores the graph", async () => {
    const res = await fetch(`${base}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: TRACE }),
    });
    expect(res.status).toBe(200);
    const graph = (await res.json()) as { meta: { resolvedFrames: number } };
    expect(graph.meta.resolvedFrames).toBeGreaterThanOrEqual(3);

    const again = await fetch(`${base}/api/graph`);
    expect(again.status).toBe(200);
  });

  it("400s on input with no trace, echoing the searched anchors", async () => {
    const res = await fetch(`${base}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "nothing here" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("Traceback (most recent call last)");
  });

  it("serves sandboxed source snippets", async () => {
    const res = await fetch(`${base}/api/source?file=store.py&around=8`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: string; lines: string[]; focus: number };
    expect(body.file).toBe("store.py");
    expect(body.lines.join("\n")).toContain("return CATALOG[sku]");
    expect(body.focus).toBe(8);
  });

  it("403s path traversal and absolute paths", async () => {
    for (const evil of ["../../etc/hosts", "/etc/hosts", "..%2F..%2Fetc%2Fhosts"]) {
      const res = await fetch(`${base}/api/source?file=${evil}`);
      expect(res.status).toBe(403);
    }
  });
});
