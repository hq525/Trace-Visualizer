import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";

const MAIN = `import { rate } from "@app/fx";

export function main() {
  return rate(1);
}
`;

const FX = `export function rate(n: number) {
  return n * 2;
}
`;

// tsconfig with JSONC comments + trailing comma — best-effort parsing (§5.4)
const TSCONFIG = `{
  // path aliases
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@app/*": ["src/*"],
    },
  },
}
`;

const TRACE = `TypeError: boom
    at rate (/srv/checkout/src/fx.ts:2:10)
    at main (/srv/checkout/src/main.ts:4:10)
`;

let root: string;
let graph: TraceGraph;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-tsconfig-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/main.ts"), MAIN);
  fs.writeFileSync(path.join(root, "src/fx.ts"), FX);
  fs.writeFileSync(path.join(root, "tsconfig.json"), TSCONFIG);
  const result = await runPipeline(TRACE, root);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("tsconfig paths best-effort (§5.4)", () => {
  it("resolves alias imports to call edges between spine nodes", () => {
    const call = graph.edges.filter((e) => e.kind === "call");
    expect(call).toHaveLength(1);
    const from = graph.nodes.find((n) => n.id === call[0].from);
    const to = graph.nodes.find((n) => n.id === call[0].to);
    expect(from?.name).toBe("main");
    expect(to?.name).toBe("rate");
  });
});
