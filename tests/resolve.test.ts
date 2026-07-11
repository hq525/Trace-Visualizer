import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Frame, ParsedTrace } from "../src/parsers/types.js";
import { resolveTrace } from "../src/resolve/index.js";
import { buildRepoIndex, type RepoIndex } from "../src/resolve/repo.js";

const API_SOURCE = `from fastapi import FastAPI
app = FastAPI()

class OrderStore:
    def get(self, oid):
        return self._rows[oid]

@app.get("/orders/{oid}")
def read_order(oid: str):
    store = OrderStore()
    return store.get(oid)
`;

let root: string;
let index: RepoIndex;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-resolve-"));
  fs.mkdirSync(path.join(root, "shop"));
  fs.writeFileSync(path.join(root, "shop/api.py"), API_SOURCE);
  index = buildRepoIndex(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function frame(partial: Partial<Frame> & { rawPath: string; line: number | null }): Frame {
  return { isExternal: false, ...partial };
}

function traceWith(frames: Frame[]): ParsedTrace {
  return { exception: { type: "KeyError", message: "'x'" }, frames };
}

describe("frame → symbol resolution (§5.5)", () => {
  it("resolves in-repo frames to the innermost matching symbol", async () => {
    const trace = traceWith([
      frame({ rawPath: "/srv/shop/api.py", line: 11, symbol: "read_order" }),
      frame({ rawPath: "/srv/shop/api.py", line: 6, symbol: "get" }),
    ]);
    const { resolved } = await resolveTrace(trace, index);
    expect(resolved[0].file).toBe("shop/api.py");
    expect(resolved[0].symbol?.qualifiedName).toBe("read_order");
    expect(resolved[0].badges).toEqual([]);
    expect(resolved[1].symbol?.qualifiedName).toBe("OrderStore.get");
  });

  it("does not analyze or resolve external frames", async () => {
    const trace = traceWith([
      frame({
        rawPath: "/usr/lib/python3.13/runpy.py",
        line: 88,
        symbol: "_run_code",
        isExternal: true,
      }),
    ]);
    const { resolved, analyses } = await resolveTrace(trace, index);
    expect(resolved[0].file).toBeNull();
    expect(resolved[0].symbol).toBeNull();
    expect(analyses.size).toBe(0);
  });

  it("badges line/name mismatches and resolves to the enclosing symbol", async () => {
    const trace = traceWith([
      // line 2 is module level; the printed symbol says read_order → drift
      frame({ rawPath: "/srv/shop/api.py", line: 6, symbol: "read_order" }),
    ]);
    const { resolved } = await resolveTrace(trace, index);
    expect(resolved[0].symbol?.qualifiedName).toBe("OrderStore.get");
    expect(resolved[0].badges).toContain("line-name-mismatch");
  });

  it("resolves <module> frames to the file (symbol null, no badge)", async () => {
    const trace = traceWith([frame({ rawPath: "/srv/shop/api.py", line: 2, symbol: "<module>" })]);
    const { resolved } = await resolveTrace(trace, index);
    expect(resolved[0].file).toBe("shop/api.py");
    expect(resolved[0].symbol).toBeNull();
    expect(resolved[0].badges).toEqual([]);
  });

  it("keeps unmatched in-repo paths as unresolved (file null)", async () => {
    const trace = traceWith([frame({ rawPath: "/elsewhere/ghost.py", line: 1, symbol: "f" })]);
    const { resolved } = await resolveTrace(trace, index);
    expect(resolved[0].file).toBeNull();
  });

  it("walks chained traces and keeps global frame indices", async () => {
    const inner = traceWith([frame({ rawPath: "/srv/shop/api.py", line: 6, symbol: "get" })]);
    const outer: ParsedTrace = {
      exception: { type: "RuntimeError", message: "wrapped" },
      frames: [frame({ rawPath: "/srv/shop/api.py", line: 11, symbol: "read_order" })],
      chained: { relation: "cause", trace: inner },
    };
    const { resolved } = await resolveTrace(outer, index);
    expect(resolved).toHaveLength(2);
    expect(new Set(resolved.map((r) => r.frameIndex)).size).toBe(2);
  });
});
