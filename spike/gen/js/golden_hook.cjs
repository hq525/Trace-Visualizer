// Phase 0 throwaway: preloaded via `node --require` in golden mode.
// Replaces Error.prepareStackTrace so err.stack yields structured V8 CallSites
// (ground truth), and dumps a golden ParsedTrace JSON on uncaught errors.
"use strict";
const fs = require("node:fs");

Error.prepareStackTrace = (_err, sites) => sites;

function frameOf(cs) {
  const file = cs.getFileName() ?? "<anonymous>";
  const line = cs.getLineNumber();
  const column = cs.getColumnNumber();
  const loc = `${file}:${line}:${column}`;
  const s = cs.toString(); // exactly what V8 prints after "at "
  let symbol;
  if (s === loc || s === `(${loc})`) {
    symbol = undefined;
  } else if (s.endsWith(` (${loc})`)) {
    symbol = s.slice(0, -(loc.length + 3));
  } else {
    const m = s.match(/^(.*?) \(/);
    symbol = m ? m[1] : undefined;
  }
  const f = { rawPath: file, line, column };
  if (symbol) f.symbol = symbol;
  return f;
}

function buildTrace(err) {
  const sites = err.stack; // array, thanks to prepareStackTrace
  const frames = Array.isArray(sites) ? sites.map(frameOf).reverse() : []; // root -> crash
  const d = {
    exception: { type: err.name, message: err.message },
    frames,
  };
  if (err.cause instanceof Error) {
    d.chained = { relation: "cause", trace: buildTrace(err.cause) };
  }
  return d;
}

function dumpGolden(err) {
  const out = process.env.GOLDEN_OUT;
  if (!out) return;
  const golden = { language: "js", ...buildTrace(err) };
  fs.writeFileSync(out, JSON.stringify(golden, null, 2));
}

globalThis.__dumpGolden = (err) => {
  dumpGolden(err);
  process.exit(1);
};

process.on("uncaughtException", (err) => {
  dumpGolden(err);
  process.exit(1);
});
