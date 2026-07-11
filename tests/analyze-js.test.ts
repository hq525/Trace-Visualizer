import { describe, expect, it } from "vitest";
import { analyzeJsSource } from "../src/analyze/javascript.js";

const SOURCE = `import express from "express";
import { helper as h, format } from "./util";

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

describe("js/ts tree-sitter analysis (§5.4)", () => {
  it("extracts declarations, methods, and bound arrows with spans", async () => {
    const a = await analyzeJsSource("src/ledger.ts", SOURCE);
    const names = a.symbols.map((s) => s.qualifiedName);
    expect(names).toContain("LedgerStore");
    expect(names).toContain("LedgerStore.append");
    expect(names).toContain("record");
    expect(names).toContain("settle");
    expect(names).toContain("main");

    const append = a.symbols.find((s) => s.qualifiedName === "LedgerStore.append");
    expect(append).toMatchObject({ name: "append", kind: "function", span: [12, 15] });
    const cls = a.symbols.find((s) => s.qualifiedName === "LedgerStore");
    expect(cls?.kind).toBe("class");
  });

  it("extracts imports with local names", async () => {
    const a = await analyzeJsSource("src/ledger.ts", SOURCE);
    expect(a.imports).toContainEqual({ module: "express", names: ["express"], line: 1 });
    expect(a.imports).toContainEqual({ module: "./util", names: ["h", "format"], line: 2 });
  });

  it("extracts call sites incl. member calls and constructor calls", async () => {
    const a = await analyzeJsSource("src/ledger.ts", SOURCE);
    expect(a.calls).toContainEqual({ calleeName: "h", line: 6, enclosing: "record" });
    expect(a.calls).toContainEqual({ calleeName: "record", line: 14, enclosing: "append" });
    expect(a.calls).toContainEqual({ calleeName: "LedgerStore", line: 19, enclosing: "settle" });
    expect(a.calls).toContainEqual({ calleeName: "append", line: 20, enclosing: "settle" });
    expect(a.calls).toContainEqual({ calleeName: "settle", line: 24, enclosing: "main" });
  });

  it("handles require() as an import", async () => {
    const a = await analyzeJsSource(
      "lib/app.cjs",
      'const express = require("express");\nfunction boot() { return express(); }\n',
    );
    expect(a.imports).toContainEqual({ module: "express", names: ["express"], line: 1 });
  });
});
