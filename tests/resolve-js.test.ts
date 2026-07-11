import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Frame, ParsedTrace } from "../src/parsers/types.js";
import { resolveTrace } from "../src/resolve/index.js";
import { buildRepoIndex, type RepoIndex } from "../src/resolve/repo.js";

const SOURCE = `import { helper as h } from "./util";

const audit = {
  record(entry: string) {
    return h(entry);
  },
};

export class LedgerStore {
  entries: string[] = [];
  append(entry: string) {
    this.entries.push(entry);
    return audit.record(entry);
  }
}

export const settle = (id: string) => {
  const store = new LedgerStore();
  return store.append(id);
};

function main() {
  return settle("T-1");
}
`;

let root: string;
let index: RepoIndex;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-resolve-js-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/ledger.ts"), SOURCE);
  index = buildRepoIndex(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function frame(partial: Partial<Frame> & { rawPath: string; line: number | null }): Frame {
  return { isExternal: false, ...partial };
}

function traceWith(frames: Frame[]): ParsedTrace {
  return { exception: { type: "TypeError", message: "boom" }, frames };
}

describe("js frame → symbol resolution (§5.5)", () => {
  it("resolves dotted method symbols to class-qualified functions", async () => {
    const { resolved } = await resolveTrace(
      traceWith([frame({ rawPath: "/prod/app/src/ledger.ts", line: 12, symbol: "LedgerStore.append" })]),
      index,
    );
    expect(resolved[0].symbol?.qualifiedName).toBe("LedgerStore.append");
    expect(resolved[0].badges).toEqual([]);
  });

  it("normalizes async / new / [as alias] symbol forms", async () => {
    const { resolved } = await resolveTrace(
      traceWith([
        frame({ rawPath: "src/ledger.ts", line: 5, symbol: "async Object.record" }),
        frame({ rawPath: "src/ledger.ts", line: 12, symbol: "Ledger.append [as push]" }),
      ]),
      index,
    );
    expect(resolved[0].symbol?.name).toBe("record");
    expect(resolved[0].badges).toEqual([]);
    expect(resolved[1].symbol?.name).toBe("append");
  });

  it("resolves anonymous frames by span with no badge", async () => {
    const { resolved } = await resolveTrace(
      traceWith([frame({ rawPath: "src/ledger.ts", line: 19, column: 17 })]),
      index,
    );
    expect(resolved[0].symbol?.qualifiedName).toBe("settle");
    expect(resolved[0].badges).toEqual([]);
  });

  it("badges drifted line/name pairs", async () => {
    const { resolved } = await resolveTrace(
      traceWith([frame({ rawPath: "src/ledger.ts", line: 24, symbol: "append" })]),
      index,
    );
    expect(resolved[0].symbol?.qualifiedName).toBe("main");
    expect(resolved[0].badges).toContain("line-name-mismatch");
  });
});
