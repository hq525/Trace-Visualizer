# Adding a language to crashpath

Sourcetrail died maintaining native per-language indexers. crashpath's bet: a language costs
**one ~200-line frame parser + one tree-sitter walker**. This guide walks through both, using
the shipped Python/JS implementations as reference.

## 1. Frame parser — turn printed stack frames into `Frame[]`

Reference: `src/parsers/python.ts`, `src/parsers/v8.ts`. Your parser produces:

```ts
interface Frame {
  rawPath: string;          // exactly as printed
  line: number | null;
  column?: number;
  symbol?: string;          // function name as the runtime printed it
  isExternal: boolean;      // stdlib / vendored deps → collapsed into chips
  repeated?: number;        // "[Previous line repeated N times]"-style collapsing
}

interface ParsedTrace {
  exception: { type: string; message: string };
  frames: Frame[];          // ALWAYS normalized root-call → crash
  chained?: { relation: "cause" | "context"; trace: ParsedTrace };
}
```

Rules learned the hard way (all corpus-tested):

- **Normalize direction.** Python prints root→crash; V8 prints crash-first. Your `frames`
  must be root-call → crash regardless.
- **Anchor conservatively.** Extraction (`src/extract`) scans dirty logs line-by-line; your
  anchor regex must not fire on prose. Require the structural line *after* the anchor too
  (e.g. V8 requires an `at …` line after the header).
- **Expect garbage around frames**: log prefixes are stripped before you run, but glued
  suffixes, elision markers ("... N lines matching cause stack trace ..."), and multiline
  messages are yours to handle.
- **Golden fixtures or it didn't happen.** Add `fixtures/traces/NN-name.txt` +
  `NN-name.golden.json`. Derive goldens from the runtime when you can (see
  `spike/gen/` for the excepthook / prepareStackTrace tricks) — never from your own parser.

Wire the anchor into `extractTraces()` in `src/extract/index.ts`.

## 2. Analyzer — turn source files into symbol tables

Reference: `src/analyze/javascript.ts` (~200 lines). Your walker produces:

```ts
interface FileAnalysis {
  symbols: { name; qualifiedName; kind: "function" | "class"; span: [start, end]; decorators: string[] }[];
  imports: { module: string; names: string[]; line: number }[];
  calls:   { calleeName: string; line: number; enclosing?: string }[];
}
```

- Grab the grammar wasm from `tree-sitter-wasms` (pin the build that matches
  `web-tree-sitter@0.20.8`) into `grammars/`, register the extension in
  `src/analyze/treesitter.ts` (`grammarForFile`), and dispatch in
  `src/resolve/index.ts` (`analyzeRepoFile`).
- Record **decorators/annotations** — they power ghost-edge hints
  (`decorator-dispatched (@app.route)`).
- Calls are name-level only. Resolution emits an edge only on a unique match; when in doubt,
  record nothing — ghost edges will honestly mark what you couldn't see.

## 3. Definition of done

- Corpus stays green (`npm run corpus`) with your new fixtures included.
- A mini demo app + pre-recorded trace under `demo/<lang>/` if you want a `crashpath demo <lang>`.
- Resolution sanity: real traces from a real repo resolve ≥80% of in-repo frames
  (see `docs/phase0-report.md` for the measurement pattern).

Open a PR — first community language parser gets celebrated loudly.
