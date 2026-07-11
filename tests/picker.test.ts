import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTraces, runPipeline } from "../src/pipeline.js";
import { type RunningServer, startServer } from "../src/server/index.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/traces", import.meta.url));
const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));

const PY = fs.readFileSync(path.join(FIXTURES, "01-py-attributeerror-deep.txt"), "utf8");
const JS = fs.readFileSync(path.join(FIXTURES, "21-js-typeerror-deep-cjs.txt"), "utf8");
const PY_DEMO = fs.readFileSync(path.join(DEMO, "trace.txt"), "utf8");
const BLOB = `${PY}\n--- next incident ---\n${JS}\n--- again ---\n${PY}`;

describe("multi-trace listing (§5.1.4)", () => {
  it("lists distinct traces and dedupes identical signatures with a count", () => {
    const summaries = listTraces(BLOB);
    expect(summaries).toHaveLength(2);
    const py = summaries.find((s) => s.language === "python");
    const js = summaries.find((s) => s.language === "js");
    expect(py?.exceptionType).toBe("AttributeError");
    expect(py?.count).toBe(2);
    expect(js?.exceptionType).toBe("TypeError");
    expect(js?.count).toBe(1);
  });

  it("runPipeline picks the requested trace", async () => {
    const blob = `${PY_DEMO}\n${JS}`;
    const summaries = listTraces(blob);
    const jsIndex = summaries.find((s) => s.language === "js")?.index;
    const result = await runPipeline(blob, DEMO, { pick: jsIndex });
    // js frames don't resolve against the python demo repo → exit-3 semantics
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.exitCode).toBe(3);
    const resultPy = await runPipeline(blob, DEMO, { pick: 0 });
    expect(resultPy.ok).toBe(true);
  });
});

describe("picker over the server", () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer({ repoRoot: DEMO, port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns a picker payload for multi-trace input, then builds the picked graph", async () => {
    const blob = `${PY_DEMO}\nsome log noise\n${JS}`;
    const first = await fetch(`${server.url}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: blob }),
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      picker?: { index: number; language: string; exceptionType: string }[];
    };
    expect(body.picker).toHaveLength(2);

    const pyEntry = body.picker?.find((p) => p.language === "python");
    const picked = await fetch(`${server.url}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: blob, pick: pyEntry?.index }),
    });
    expect(picked.status).toBe(200);
    const graph = (await picked.json()) as { meta: { language: string } };
    expect(graph.meta.language).toBe("python");
  });

  it("single-trace input never shows a picker", async () => {
    const res = await fetch(`${server.url}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: PY_DEMO }),
    });
    expect(res.status).toBe(200);
    const graph = (await res.json()) as { picker?: unknown; meta?: { language: string } };
    expect(graph.picker).toBeUndefined();
    expect(graph.meta?.language).toBe("python");
  });
});
