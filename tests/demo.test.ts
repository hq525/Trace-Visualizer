import { type ChildProcess, execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(ROOT, "dist/cli/index.js");

let child: ChildProcess | null = null;

beforeAll(() => {
  execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "pipe" });
}, 60_000);

afterAll(() => {
  child?.kill();
});

describe("crashpath demo python (§7 Phase 1 acceptance)", () => {
  it("serves the demo graph in under 5 seconds from process spawn", async () => {
    const startedAt = Date.now();
    child = spawn(process.execPath, [CLI, "demo", "python", "--no-open"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no URL within 5s")), 5000);
      let buffer = "";
      child?.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const m = buffer.match(/crashpath: (http:\/\/127\.0\.0\.1:\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child?.on("exit", (code) => reject(new Error(`demo exited early (${code})`)));
    });

    const res = await fetch(`${url}/api/graph`);
    expect(res.status).toBe(200);
    const graph = (await res.json()) as {
      meta: { resolvedFrames: number };
      nodes: { crash?: boolean }[];
    };
    expect(graph.meta.resolvedFrames).toBeGreaterThanOrEqual(5);
    expect(graph.nodes.some((n) => n.crash)).toBe(true);

    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);
});

describe("crashpath demo node (§7 Phase 2 acceptance)", () => {
  it("serves a graph whose crash frame was rewritten via sourcemap", async () => {
    const child2 = spawn(process.execPath, [CLI, "demo", "node", "--no-open"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no URL within 5s")), 5000);
        let buffer = "";
        child2.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const m = buffer.match(/crashpath: (http:\/\/127\.0\.0\.1:\d+)/);
          if (m) {
            clearTimeout(timer);
            resolve(m[1]);
          }
        });
        child2.on("exit", (code) => reject(new Error(`demo node exited early (${code})`)));
      });

      const res = await fetch(`${url}/api/graph`);
      expect(res.status).toBe(200);
      const graph = (await res.json()) as {
        meta: { language: string };
        nodes: { crash?: boolean; file?: string; badges: string[] }[];
      };
      expect(graph.meta.language).toBe("js");
      const crash = graph.nodes.find((n) => n.crash);
      expect(crash?.file).toBe("src/pricing.ts");
      expect(crash?.badges).toContain("via-sourcemap");
      const mapped = graph.nodes.filter((n) => n.badges.includes("via-sourcemap"));
      expect(mapped.length).toBeGreaterThanOrEqual(2);
    } finally {
      child2.kill();
    }
  }, 20_000);
});
