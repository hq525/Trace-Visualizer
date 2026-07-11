#!/usr/bin/env node
// Phase 0 throwaway: run extract+parse over fixtures/traces, compare to goldens,
// print the parse-rate table (the §7 gate metric).
// Usage: node spike/corpus.mjs [--dump <fixture-basename>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractTraces } from "./parse.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "fixtures", "traces");

const dumpTarget = process.argv.includes("--dump")
  ? process.argv[process.argv.indexOf("--dump") + 1]
  : null;

function frameEq(got, want) {
  if (!got) return `missing frame`;
  if (got.rawPath !== want.rawPath) return `path ${got.rawPath} != ${want.rawPath}`;
  if ((got.line ?? null) !== (want.line ?? null)) return `line ${got.line} != ${want.line}`;
  const gs = got.symbol ?? null;
  const ws = want.symbol ?? null;
  if (gs !== ws) return `symbol ${JSON.stringify(gs)} != ${JSON.stringify(ws)}`;
  if (want.column != null && got.column != null && got.column !== want.column)
    return `column ${got.column} != ${want.column}`;
  if (want.repeated != null && got.repeated !== want.repeated)
    return `repeated ${got.repeated} != ${want.repeated}`;
  return null;
}

function traceEq(got, want, ctx = "") {
  const errs = [];
  if (!got) return [`${ctx}no trace parsed`];
  if (got.exception.type !== want.exception.type)
    errs.push(`${ctx}type ${got.exception.type} != ${want.exception.type}`);
  const gm = (got.exception.message ?? "").trim();
  const wm = (want.exception.message ?? "").trim();
  if (!(gm.startsWith(wm) || wm.startsWith(gm)))
    errs.push(`${ctx}message ${JSON.stringify(gm.slice(0, 60))} !~ ${JSON.stringify(wm.slice(0, 60))}`);
  if (got.frames.length !== want.frames.length) {
    errs.push(`${ctx}frame count ${got.frames.length} != ${want.frames.length}`);
  } else {
    want.frames.forEach((wf, idx) => {
      const e = frameEq(got.frames[idx], wf);
      if (e) errs.push(`${ctx}frame[${idx}] ${e}`);
    });
  }
  if (want.chained) {
    if (!got.chained) errs.push(`${ctx}missing chained (${want.chained.relation})`);
    else {
      if (got.chained.relation !== want.chained.relation)
        errs.push(`${ctx}chain relation ${got.chained.relation} != ${want.chained.relation}`);
      errs.push(...traceEq(got.chained.trace, want.chained.trace, `${ctx}chained.`));
    }
  } else if (got.chained) {
    errs.push(`${ctx}unexpected chained block`);
  }
  return errs;
}

function countFrames(t) {
  return t ? t.frames.length + (t.chained ? countFrames(t.chained.trace) : 0) : 0;
}
function countMatched(got, want) {
  if (!got || !want) return 0;
  let n = 0;
  const len = Math.min(got.frames.length, want.frames.length);
  for (let i = 0; i < len; i++) if (!frameEq(got.frames[i], want.frames[i])) n++;
  if (got.chained && want.chained) n += countMatched(got.chained.trace, want.chained.trace);
  return n;
}

const fixtures = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".txt"))
  .sort();

let pass = 0;
let withGolden = 0;
let totalGoldenFrames = 0;
let totalMatchedFrames = 0;
const rows = [];
const noGolden = [];

for (const file of fixtures) {
  const base = file.replace(/\.txt$/, "");
  const text = fs.readFileSync(path.join(DIR, file), "utf8");
  const goldenPath = path.join(DIR, `${base}.golden.json`);
  const traces = extractTraces(text);
  const got = traces[0] ?? null;

  if (dumpTarget && base.startsWith(dumpTarget)) {
    console.log(JSON.stringify(traces, null, 2));
    process.exit(0);
  }

  if (!fs.existsSync(goldenPath)) {
    noGolden.push({ base, got, blocks: traces.length });
    continue;
  }
  withGolden++;
  const want = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const errs = traceEq(got, want);
  const gf = countFrames(want);
  const mf = countMatched(got, want);
  totalGoldenFrames += gf;
  totalMatchedFrames += mf;
  if (errs.length === 0) pass++;
  rows.push({ base, ok: errs.length === 0, frames: `${mf}/${gf}`, errs });
}

for (const r of rows) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.base}  frames ${r.frames}`);
  for (const e of r.errs.slice(0, 4)) console.log(`      - ${e}`);
}
console.log("\n--- no golden yet (manual audit) ---");
for (const n of noGolden) {
  const summary = n.got
    ? `${n.got.exception.type}: ${n.got.frames.length} frames (${n.blocks} block(s))`
    : "NO TRACE FOUND";
  console.log(`AUDIT ${n.base}: ${summary}`);
}
console.log(
  `\ntrace-level: ${pass}/${withGolden} (${((100 * pass) / withGolden).toFixed(1)}%)  |  frame-level: ${totalMatchedFrames}/${totalGoldenFrames} (${((100 * totalMatchedFrames) / totalGoldenFrames).toFixed(1)}%)`,
);
