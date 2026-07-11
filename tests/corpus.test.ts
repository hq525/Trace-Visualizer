import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTraces } from "../src/extract/index.js";
import type { Frame, ParsedTrace } from "../src/parsers/types.js";

const DIR = fileURLToPath(new URL("../fixtures/traces", import.meta.url));

interface GoldenFrame {
  rawPath: string;
  line: number | null;
  column?: number | null;
  symbol?: string;
  repeated?: number;
}
interface GoldenTrace {
  language?: string;
  exception: { type: string; message: string };
  frames: GoldenFrame[];
  chained?: { relation: "cause" | "context"; trace: GoldenTrace };
}

function frameErrors(got: Frame | undefined, want: GoldenFrame, idx: number): string[] {
  if (!got) return [`frame[${idx}] missing`];
  const errs: string[] = [];
  if (got.rawPath !== want.rawPath)
    errs.push(`frame[${idx}] path ${got.rawPath} != ${want.rawPath}`);
  if ((got.line ?? null) !== (want.line ?? null))
    errs.push(`frame[${idx}] line ${got.line} != ${want.line}`);
  if ((got.symbol ?? null) !== (want.symbol ?? null))
    errs.push(`frame[${idx}] symbol ${got.symbol} != ${want.symbol}`);
  if (want.column != null && got.column != null && got.column !== want.column)
    errs.push(`frame[${idx}] column ${got.column} != ${want.column}`);
  if (want.repeated != null && got.repeated !== want.repeated)
    errs.push(`frame[${idx}] repeated ${got.repeated} != ${want.repeated}`);
  return errs;
}

function traceErrors(got: ParsedTrace | undefined, want: GoldenTrace, ctx = ""): string[] {
  if (!got) return [`${ctx}no trace parsed`];
  const errs: string[] = [];
  if (got.exception.type !== want.exception.type)
    errs.push(`${ctx}type ${got.exception.type} != ${want.exception.type}`);
  const gm = got.exception.message.trim();
  const wm = want.exception.message.trim();
  if (!(gm.startsWith(wm) || wm.startsWith(gm)))
    errs.push(`${ctx}message ${JSON.stringify(gm.slice(0, 60))} !~ ${JSON.stringify(wm.slice(0, 60))}`);
  if (got.frames.length !== want.frames.length) {
    errs.push(`${ctx}frame count ${got.frames.length} != ${want.frames.length}`);
  } else {
    want.frames.forEach((wf, i) => {
      errs.push(...frameErrors(got.frames[i], wf, i).map((e) => ctx + e));
    });
  }
  if (want.chained) {
    if (!got.chained) errs.push(`${ctx}missing chained (${want.chained.relation})`);
    else {
      if (got.chained.relation !== want.chained.relation)
        errs.push(`${ctx}relation ${got.chained.relation} != ${want.chained.relation}`);
      errs.push(...traceErrors(got.chained.trace, want.chained.trace, `${ctx}chained.`));
    }
  } else if (got.chained) {
    errs.push(`${ctx}unexpected chained block`);
  }
  return errs;
}

const goldened = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".golden.json"))
  .map((f) => f.replace(/\.golden\.json$/, ""))
  .sort();

describe("corpus: every goldened fixture parses exactly", () => {
  it.each(goldened)("%s", (base) => {
    const text = fs.readFileSync(path.join(DIR, `${base}.txt`), "utf8");
    const want = JSON.parse(
      fs.readFileSync(path.join(DIR, `${base}.golden.json`), "utf8"),
    ) as GoldenTrace;
    const traces = extractTraces(text);
    if (want.language) expect(traces[0]?.language).toBe(want.language);
    expect(traceErrors(traces[0], want)).toEqual([]);
  });

  it("covers all 31 goldened fixtures", () => {
    expect(goldened).toHaveLength(31);
  });

  it("17-py-pytest-default is a documented extraction gap (no anchors)", () => {
    const text = fs.readFileSync(path.join(DIR, "17-py-pytest-default.txt"), "utf8");
    expect(extractTraces(text)).toHaveLength(0);
  });
});
