#!/usr/bin/env node
// crashpath CLI (§3.2). Zero CLI deps: node:util parseArgs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { TraceGraph } from "../graph/types.js";
import { runPipeline } from "../pipeline.js";
import { startServer } from "../server/index.js";

const HELP = `crashpath — paste a stack trace, see the failure path through your codebase

Usage:
  crashpath [options]                 Start UI (paste mode) for repo at cwd
  crashpath demo [python]             Bundled demo, zero configuration
  cmd 2>&1 | crashpath [options]      Pipe a trace in

Options:
  -t, --trace <file>   Read trace/log from file (or pipe via stdin)
  -r, --repo <path>    Repo root (default: cwd, walking up to the nearest .git)
  --json               Print graph JSON to stdout and exit
  --port <n>           Fixed port (default: random free port on 127.0.0.1)
  --no-open            Don't auto-open the browser
  -h, --help           Show this help

Exit codes: 0 ok · 2 no trace found in input · 3 no frames resolved to this repo`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      trace: { type: "string", short: "t" },
      repo: { type: "string", short: "r" },
      json: { type: "boolean", default: false },
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const subcommand = positionals[0];
  let repoRoot = values.repo ? path.resolve(values.repo) : findRepoRoot(process.cwd());

  let text: string | null = null;
  if (subcommand === "demo") {
    const flavor = positionals[1] ?? "python";
    if (flavor !== "python" && flavor !== "node") {
      process.stderr.write(
        `crashpath demo: unknown flavor '${flavor}' (available: python, node)\n`,
      );
      process.exitCode = 1;
      return;
    }
    repoRoot = fileURLToPath(new URL(`../../demo/${flavor}`, import.meta.url));
    text = fs.readFileSync(path.join(repoRoot, "trace.txt"), "utf8");
  } else if (values.trace) {
    text = fs.readFileSync(values.trace, "utf8");
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  }

  // paste mode: no input → start the server with an empty graph; the UI shows
  // the paste box and POSTs to /api/trace
  let initialGraph: TraceGraph | undefined;
  if (text !== null) {
    const result = await runPipeline(text, repoRoot);
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = result.exitCode;
      return;
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify(result.graph, null, 2)}\n`);
      return;
    }
    initialGraph = result.graph;
  } else if (values.json) {
    process.stderr.write("crashpath: --json needs a trace via -t <file> or stdin.\n");
    process.exitCode = 1;
    return;
  }

  const server = await startServer({
    repoRoot,
    port: values.port ? Number(values.port) : 0,
    ...(initialGraph ? { initialGraph } : {}),
  });
  process.stdout.write(`crashpath: ${server.url}\n`);
  if (!values["no-open"]) openBrowser(server.url);
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" })
    .on("error", () => {})
    .unref();
}

function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((err: unknown) => {
  process.stderr.write(`crashpath: unexpected error: ${String(err)}\n`);
  process.exitCode = 1;
});
