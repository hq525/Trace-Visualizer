import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "dist/cli/index.js");
const DEMO = path.join(ROOT, "demo/python");
const TRACE = fs.readFileSync(path.join(DEMO, "trace.txt"), "utf8");

let client: Client;

beforeAll(async () => {
  execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "pipe" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp"],
    cwd: ROOT,
  });
  client = new Client({ name: "crashpath-test", version: "0.0.0" });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client.close();
});

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.find((c) => c.type === "text")?.text ?? "";
}

describe("MCP server (§3.5)", () => {
  it("lists both tools", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(["export_trace_map", "map_trace"]);
  });

  it("map_trace returns the structured summary plus a live UI URL", async () => {
    const result = await client.callTool({
      name: "map_trace",
      arguments: { trace_text: TRACE, repo_path: DEMO },
    });
    const summary = JSON.parse(textOf(result)) as {
      url: string;
      exception: { type: string };
      crash: { file: string; symbol: string };
      frames_resolved: number;
      ghost_edges: { hint: string }[];
      radius_summary: string;
    };
    expect(summary.exception.type).toBe("KeyError");
    expect(summary.crash.file).toBe("fx.py");
    expect(summary.crash.symbol).toBe("_lookup_rate");
    expect(summary.frames_resolved).toBeGreaterThanOrEqual(5);
    expect(summary.ghost_edges.length).toBeGreaterThanOrEqual(1);
    expect(summary.ghost_edges[0].hint).toContain("decorator-dispatched");
    expect(summary.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // the URL is real: the graph is served for the human
    const res = await fetch(`${summary.url}/api/graph`);
    expect(res.status).toBe(200);
  });

  it("export_trace_map writes a standalone artifact and returns its path", async () => {
    const result = await client.callTool({
      name: "export_trace_map",
      arguments: { trace_text: TRACE, format: "html", repo_path: DEMO },
    });
    const { file_path } = JSON.parse(textOf(result)) as { file_path: string };
    expect(fs.existsSync(file_path)).toBe(true);
    const html = fs.readFileSync(file_path, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("KeyError");
    fs.rmSync(file_path, { force: true });
  });

  it("returns a typed error for unmappable input", async () => {
    const result = await client.callTool({
      name: "map_trace",
      arguments: { trace_text: "no trace here", repo_path: DEMO },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { exitCode: number };
    expect(body.exitCode).toBe(2);
  });
});
