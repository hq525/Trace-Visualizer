#!/usr/bin/env node
// crashpath CLI (§3.2). Zero CLI deps: node:util parseArgs.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { AiProvider } from "../ai/providers.js";
import { renderHtml, renderSvg } from "../export/index.js";
import { addRefWorktree, withRef } from "../gitref/index.js";
import type { TraceGraph } from "../graph/types.js";
import { runPipeline } from "../pipeline.js";
import { startServer } from "../server/index.js";

const HELP = `crashpath — paste a stack trace, see the failure path through your codebase

Usage:
  crashpath [options]                     Start UI (paste mode) for repo at cwd
  crashpath demo [python|node]            Bundled demo, zero configuration
  crashpath export -t <file> -o <out>     Render standalone .html or .svg
  cmd 2>&1 | crashpath [options]          Pipe a trace in

Options:
  -t, --trace <file>   Read trace/log from file (or pipe via stdin)
  -r, --repo <path>    Repo root (default: cwd, walking up to the nearest .git)
  --ref <git-ref>      Analyze the code version that crashed (git worktree)
  --ai <provider>      anthropic | openai | ollama (default: off, fully offline)
  --model <name>       Override the provider's default model
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
      ref: { type: "string" },
      output: { type: "string", short: "o" },
      ai: { type: "string" },
      model: { type: "string" },
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
  let repoLabel: string | undefined;

  // Flow D: crashpath export -t trace.txt -o failure.html|failure.svg
  if (subcommand === "export") {
    if (!values.trace || !values.output) {
      process.stderr.write(
        "crashpath export: requires -t <trace-file> and -o <out.html|out.svg>\n",
      );
      process.exitCode = 1;
      return;
    }
    const text = fs.readFileSync(values.trace, "utf8");
    const outPath = path.resolve(values.output);
    const format = path.extname(outPath);
    if (format !== ".html" && format !== ".svg") {
      process.stderr.write(
        `crashpath export: unsupported format '${format}' (use .html or .svg)\n`,
      );
      process.exitCode = 1;
      return;
    }
    const render = async (root: string): Promise<string | null> => {
      const result = await runPipeline(text, root, values.ref ? { ref: values.ref } : {});
      if (!result.ok) {
        process.stderr.write(`${result.message}\n`);
        process.exitCode = result.exitCode;
        return null;
      }
      return format === ".svg" ? renderSvg(result.graph) : renderHtml(result.graph, root);
    };
    const content = values.ref
      ? await withRef(repoRoot, values.ref, render)
      : await render(repoRoot);
    if (content !== null) {
      fs.writeFileSync(outPath, content);
      process.stdout.write(`crashpath: wrote ${outPath}\n`);
    }
    return;
  }

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
    repoLabel = flavor === "python" ? "shop (demo)" : "quotes (demo)";
    text = fs.readFileSync(path.join(repoRoot, "trace.txt"), "utf8");
  } else if (values.trace) {
    text = fs.readFileSync(values.trace, "utf8");
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  }

  // --ref: swap the repo root for a detached worktree of the crashed version
  // (§5.10); it lives until the process exits
  let refCleanup: (() => void) | undefined;
  if (values.ref) {
    try {
      const worktree = addRefWorktree(repoRoot, values.ref);
      repoRoot = worktree.root;
      refCleanup = worktree.cleanup;
      process.once("SIGINT", () => {
        refCleanup?.();
        process.exit(130);
      });
      process.once("exit", () => refCleanup?.());
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  // paste mode: no input → start the server with an empty graph; the UI shows
  // the paste box and POSTs to /api/trace
  let initialGraph: TraceGraph | undefined;
  if (text !== null) {
    const result = await runPipeline(text, repoRoot, {
      ...(repoLabel ? { repoLabel } : {}),
      ...(values.ref ? { ref: values.ref } : {}),
    });
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = result.exitCode;
      return;
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify(result.graph, null, 2)}\n`);
      refCleanup?.();
      return;
    }
    initialGraph = result.graph;
  } else if (values.json) {
    process.stderr.write("crashpath: --json needs a trace via -t <file> or stdin.\n");
    process.exitCode = 1;
    return;
  }

  let ai: { provider: AiProvider; model?: string } | undefined;
  if (values.ai) {
    if (values.ai !== "anthropic" && values.ai !== "openai" && values.ai !== "ollama") {
      process.stderr.write(
        `crashpath: unknown --ai provider '${values.ai}' (anthropic | openai | ollama)\n`,
      );
      process.exitCode = 1;
      return;
    }
    ai = { provider: values.ai, ...(values.model ? { model: values.model } : {}) };
  }

  const server = await startServer({
    repoRoot,
    port: values.port ? Number(values.port) : 0,
    ...(initialGraph ? { initialGraph } : {}),
    ...(ai ? { ai } : {}),
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
