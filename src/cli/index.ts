#!/usr/bin/env node
// crashpath CLI (§3.2). Zero CLI deps: node:util parseArgs.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runPipeline } from "../pipeline.js";

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
  if (subcommand === "demo") {
    process.stderr.write("crashpath demo: arriving in a later task of Phase 1.\n");
    process.exitCode = 1;
    return;
  }

  const repoRoot = values.repo ? path.resolve(values.repo) : findRepoRoot(process.cwd());

  let text: string | null = null;
  if (values.trace) {
    text = fs.readFileSync(values.trace, "utf8");
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  }

  if (text === null) {
    process.stderr.write(
      "crashpath: no input. Pass -t <file>, pipe a trace via stdin, or wait for paste mode (next task).\n",
    );
    process.exitCode = 1;
    return;
  }

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

  process.stderr.write("crashpath: UI server arrives in the next task; use --json for now.\n");
  process.exitCode = 1;
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
