import { execFileSync, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "dist/cli/index.js");
const DEMO = path.join(ROOT, "demo/python");

beforeAll(() => {
  execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "pipe" });
}, 60_000);

describe("crashpath CLI (§3.2)", () => {
  it("--json prints the TraceGraph and exits 0", () => {
    const out = execFileSync(
      process.execPath,
      [CLI, "--json", "-t", path.join(DEMO, "trace.txt"), "-r", DEMO],
      { encoding: "utf8" },
    );
    const graph = JSON.parse(out);
    expect(graph.meta.language).toBe("python");
    expect(graph.meta.resolvedFrames).toBeGreaterThanOrEqual(3);
    expect(graph.nodes.some((n: { crash?: boolean }) => n.crash)).toBe(true);
  });

  it("reads the trace from stdin when piped", () => {
    const text = fs.readFileSync(path.join(DEMO, "trace.txt"));
    const r = spawnSync(process.execPath, [CLI, "--json", "-r", DEMO], {
      input: text,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).meta.totalFrames).toBeGreaterThan(10);
  });

  it("exits 2 with the searched anchors when no trace is found", () => {
    const empty = path.join(os.tmpdir(), `crashpath-empty-${Date.now()}.log`);
    fs.writeFileSync(empty, "INFO nothing to see\nINFO still nothing\n");
    const r = spawnSync(process.execPath, [CLI, "--json", "-t", empty, "-r", DEMO], {
      encoding: "utf8",
    });
    fs.rmSync(empty);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Traceback (most recent call last)");
  });

  it("exits 3 with unresolved paths when no frame maps to the repo", () => {
    const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-norepo-"));
    const r = spawnSync(
      process.execPath,
      [CLI, "--json", "-t", path.join(DEMO, "trace.txt"), "-r", emptyRepo],
      { encoding: "utf8" },
    );
    fs.rmSync(emptyRepo, { recursive: true, force: true });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("/home/dev/shop/app.py");
  });
});
