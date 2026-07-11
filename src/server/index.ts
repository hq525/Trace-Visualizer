// Local server (§5.13): 127.0.0.1 only, sandboxed source reads, no telemetry.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { annotate } from "../ai/index.js";
import type { AiProvider } from "../ai/providers.js";
import type { TraceGraph } from "../graph/types.js";
import { listTraces, runPipeline } from "../pipeline.js";

export interface ServerOptions {
  repoRoot: string;
  port: number;
  /** pre-load a graph (demo / -t flows) */
  initialGraph?: TraceGraph;
  /** optional AI annotation (§3.4); absent = feature off, zero network */
  ai?: { provider: AiProvider; model?: string };
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const SNIPPET_RADIUS = 10;

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const repoRoot = fs.realpathSync(path.resolve(options.repoRoot));
  let currentGraph: TraceGraph | null = options.initialGraph ?? null;

  const app = new Hono();

  app.get("/api/graph", (c) => {
    if (!currentGraph) return c.json({ message: "no trace loaded yet" }, 404);
    return c.json(currentGraph);
  });

  app.get("/api/config", (c) => c.json({ ai: options.ai ?? null }));

  // §3.4: annotation only — the response never contains nodes or edges
  app.post("/api/ai", async (c) => {
    if (!options.ai) return c.json({ message: "start crashpath with --ai <provider>" }, 501);
    if (!currentGraph) return c.json({ message: "no trace loaded yet" }, 404);
    const result = await annotate(currentGraph, repoRoot, options.ai);
    if (!result.ok) return c.json({ message: result.error }, 502);
    return c.json(result.annotation);
  });

  app.post("/api/trace", async (c) => {
    let text: string;
    let pick: number | undefined;
    try {
      const body = (await c.req.json()) as { text?: string; pick?: number };
      text = body.text ?? "";
      pick = body.pick;
    } catch {
      return c.json({ message: "expected JSON body: { text: string, pick?: number }" }, 400);
    }
    // several distinct traces and no choice made yet → let the human pick (§5.1.4)
    const summaries = listTraces(text);
    if (summaries.length > 1 && pick === undefined) {
      return c.json({ picker: summaries });
    }
    const result = await runPipeline(text, repoRoot, pick === undefined ? {} : { pick });
    if (!result.ok) {
      return c.json({ message: result.message }, result.exitCode === 2 ? 400 : 422);
    }
    currentGraph = result.graph;
    return c.json(result.graph);
  });

  app.get("/api/source", (c) => {
    const file = c.req.query("file") ?? "";
    const around = Number(c.req.query("around") ?? "1");
    // sandbox: reject lexically out-of-root paths before touching the fs,
    // then re-check the realpath so symlinks cannot escape either
    const abs = path.resolve(repoRoot, file);
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) {
      return c.json({ message: "forbidden" }, 403);
    }
    let real: string;
    try {
      real = fs.realpathSync(abs);
    } catch {
      return c.json({ message: "not found" }, 404);
    }
    if (real !== repoRoot && !real.startsWith(repoRoot + path.sep)) {
      return c.json({ message: "forbidden" }, 403);
    }
    if (!fs.statSync(real).isFile()) return c.json({ message: "not a file" }, 404);
    const all = fs.readFileSync(real, "utf8").split("\n");
    const focus = Math.min(Math.max(1, Math.floor(around) || 1), all.length);
    const start = Math.max(1, focus - SNIPPET_RADIUS);
    const end = Math.min(all.length, focus + SNIPPET_RADIUS);
    return c.json({
      file,
      start,
      focus,
      lines: all.slice(start - 1, end),
    });
  });

  // built UI assets, when present (dist/ui next to dist/server)
  const uiDir = fileURLToPath(new URL("../ui", import.meta.url));
  if (fs.existsSync(uiDir)) {
    const relRoot = path.relative(process.cwd(), uiDir).split(path.sep).join("/");
    app.use("/*", serveStatic({ root: relRoot }));
  }

  return new Promise((resolvePromise) => {
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: options.port },
      (info) => {
        resolvePromise({
          url: `http://127.0.0.1:${info.port}`,
          port: info.port,
          close: () =>
            new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        });
      },
    );
  });
}
