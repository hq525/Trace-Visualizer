// MCP stdio server (§3.5): a distribution channel as much as a feature.
// Agents call map_trace mid-debug and get a URL for the human plus a
// structured summary they can reason over. stdout is the JSON-RPC channel —
// nothing else may write to it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { renderHtml, renderSvg } from "../export/index.js";
import { withRef } from "../gitref/index.js";
import type { TraceGraph } from "../graph/types.js";
import { runPipeline } from "../pipeline.js";
import { type RunningServer, startServer } from "../server/index.js";

let httpServer: RunningServer | null = null;
let httpRoot: string | null = null;

/** start (or reuse) the local UI server and load the graph into it */
async function ensureUiServer(repoRoot: string, traceText: string): Promise<string> {
  if (httpServer && httpRoot !== repoRoot) {
    await httpServer.close();
    httpServer = null;
  }
  if (!httpServer) {
    httpServer = await startServer({ repoRoot, port: 0 });
    httpRoot = repoRoot;
  }
  await fetch(`${httpServer.url}/api/trace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: traceText, pick: 0 }),
  });
  return httpServer.url;
}

function summarize(graph: TraceGraph, url: string): string {
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;
  const crash = graph.nodes.find((n) => n.crash);
  const radius = graph.nodes.filter((n) => !n.onSpine).map((n) => n.name);
  return JSON.stringify(
    {
      url,
      exception: graph.exception,
      crash: crash
        ? { file: crash.file ?? null, line: crash.line ?? null, symbol: crash.name }
        : null,
      frames_resolved: graph.meta.resolvedFrames,
      frames_total: graph.meta.totalFrames,
      ghost_edges: graph.edges
        .filter((e) => e.kind === "ghost")
        .map((e) => ({ from: nameOf(e.from), to: nameOf(e.to), hint: e.ghostHint })),
      radius_summary:
        radius.length > 0 ? `1-hop context: ${radius.join(", ")}` : "no blast radius found",
    },
    null,
    2,
  );
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "crashpath", version: "0.1.0" });

  server.tool(
    "map_trace",
    "Map a raw stack trace (or dirty log blob) onto a repository: parses the trace, resolves frames to symbols via tree-sitter, and returns a structured failure summary plus a local UI URL for the human.",
    {
      trace_text: z.string().describe("the raw stack trace / log text"),
      repo_path: z.string().optional().describe("repository root (default: cwd)"),
      ref: z.string().optional().describe("git ref of the version that crashed (§5.10)"),
    },
    async ({ trace_text, repo_path, ref }) => {
      const repoRoot = path.resolve(repo_path ?? process.cwd());
      const run = (root: string) => runPipeline(trace_text, root, ref ? { ref } : {});
      const result = ref ? await withRef(repoRoot, ref, run) : await run(repoRoot);
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.message, exitCode: result.exitCode }),
            },
          ],
        };
      }
      const url = await ensureUiServer(repoRoot, trace_text);
      return { content: [{ type: "text" as const, text: summarize(result.graph, url) }] };
    },
  );

  server.tool(
    "export_trace_map",
    "Render a trace as a standalone artifact (self-contained .html or .svg) and return its file path — attach it to an issue or share it.",
    {
      trace_text: z.string().describe("the raw stack trace / log text"),
      format: z.enum(["html", "svg"]),
      repo_path: z.string().optional().describe("repository root (default: cwd)"),
    },
    async ({ trace_text, format, repo_path }) => {
      const repoRoot = path.resolve(repo_path ?? process.cwd());
      const result = await runPipeline(trace_text, repoRoot);
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: result.message, exitCode: result.exitCode }),
            },
          ],
        };
      }
      const content =
        format === "svg" ? renderSvg(result.graph) : renderHtml(result.graph, repoRoot);
      const filePath = path.join(os.tmpdir(), `crashpath-export-${Date.now()}.${format}`);
      fs.writeFileSync(filePath, content);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ file_path: filePath }) }],
      };
    },
  );

  await server.connect(new StdioServerTransport());
}
