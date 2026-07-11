# Phase 1: crashpath Python end-to-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx crashpath` on a Python trace → interactive spine UI in the browser; `crashpath --json` prints the §5.9 TraceGraph; `crashpath demo python` works with zero config.

**Architecture:** Pure-function pipeline (extract → parse → resolve → analyze → graph) with serializable outputs at every stage, orchestrated by a thin CLI; a hono server exposes the graph + sandboxed source reads to a Vite/React SVG UI. The proven spike parser (31/32 corpus) is ported, not rewritten.

**Tech Stack:** TypeScript strict ESM, Node ≥20, web-tree-sitter 0.20.8 + vendored `tree-sitter-python.wasm` (tree-sitter-wasms 0.1.13 build — ABI-matched pair, learned in Phase 0), hono + @hono/node-server, React 18 + Vite + Tailwind, vitest, biome, GitHub Actions (ubuntu/macos/windows).

## Global Constraints (from plan.md)

- Node ≥ 20, ESM only, package/bin name `crashpath`, MIT.
- No Mermaid, no DB/Docker/daemon/telemetry, no AI in Phase 1, no type inference (name-based edges only).
- Server binds 127.0.0.1 only; `/api/source` must realpath-sandbox to repo root.
- No whole-repo pass: parse only trace-touched files + 1-level imports; caps ≤100 candidate files, ≤150 parsed, ≤2 MB/file.
- Exit codes: 0 success · 2 "no trace found" (+ anchors searched) · 3 "no frames resolved to this repo" (+ top unresolved paths).
- `fixtures/traces/**` goldens are FROZEN — never edit without human approval.
- CLI deps: none beyond the stack above (arg parsing via `node:util` parseArgs).
- Frames normalized root-call → crash everywhere.
- Conventional commits; commit after every task.

## File Structure

```
package.json / tsconfig.json / biome.json / vitest.config.ts
grammars/tree-sitter-python.wasm     # vendored, committed (~420 KB)
src/
  parsers/types.ts    # Frame, ParsedTrace, FrameParser (§5.2 verbatim)
  extract/index.ts    # cleanInput, extractTraces  (port: spike/parse.mjs stage 1 + block detect)
  parsers/python.ts   # parsePythonChain/Block     (port: spike/parse.mjs)
  parsers/v8.ts       # parseV8Block/parseAtLine   (port: spike/parse.mjs)
  analyze/types.ts    # SymbolInfo, CallSite, ImportInfo, FileAnalysis
  analyze/treesitter.ts # runtime init + grammar loading
  analyze/python.ts   # tree walk → FileAnalysis
  resolve/repo.ts     # RepoIndex: file list (git ls-files | walk), suffix matcher
  resolve/index.ts    # frame → file → symbol + badges (§5.5)
  graph/types.ts      # GraphNode/GraphEdge/TraceGraph (§5.9 verbatim)
  graph/build.ts      # spine, external chips, contains/import/call edges, meta
  pipeline.ts         # runPipeline(text, repoRoot) → TraceGraph  (composition root)
  server/index.ts     # hono: GET /api/graph, POST /api/trace, GET /api/source, static ui
  cli/index.ts        # parseArgs, stdin/-t/-r/--json/--port/--no-open, demo, exit codes
demo/python/          # mini FastAPI shop app (source-only, never executed) + trace.txt (pre-recorded)
tests/                # vitest: corpus.test.ts, extract.test.ts, analyze.test.ts,
                      #         repo.test.ts, resolve.test.ts, graph.test.ts, cli.test.ts, server.test.ts
ui/                   # Vite React app → built to dist/ui (visual tokens from spike/mock/spine.html)
.github/workflows/ci.yml
CLAUDE.md
```

Interfaces between stages (single source of truth):

```ts
// parsers/types.ts (§5.2)
export interface Frame {
  rawPath: string; line: number | null; column?: number;
  symbol?: string; isExternal: boolean; sourceLine?: string; repeated?: number;
}
export interface ParsedTrace {
  language: "python" | "js";
  exception: { type: string; message: string };
  frames: Frame[];                       // root-call → crash
  chained?: { relation: "cause" | "context"; trace: ParsedTrace };
  location?: { rawPath: string; line: number | null };  // SyntaxError site
}
// extract/index.ts
export function extractTraces(text: string): ParsedTrace[];
// analyze/python.ts
export async function analyzePythonFile(absPath: string, source: string): Promise<FileAnalysis>;
// resolve/repo.ts
export function buildRepoIndex(root: string): RepoIndex;         // { root, files: string[] (posix, repo-rel) }
export function matchPath(index: RepoIndex, rawPath: string): { file: string | null; ambiguous: boolean };
// resolve/index.ts
export interface ResolvedFrame { frame: Frame; frameIndex: number; file: string | null;
  symbol: SymbolInfo | null; badges: string[]; }
export async function resolveTrace(trace: ParsedTrace, index: RepoIndex): Promise<{
  resolved: ResolvedFrame[]; analyses: Map<string, FileAnalysis>; }>;
// graph/build.ts
export function buildGraph(trace: ParsedTrace, resolved: ResolvedFrame[],
  analyses: Map<string, FileAnalysis>, meta: { repo: string }): TraceGraph;
// pipeline.ts
export async function runPipeline(text: string, repoRoot: string): Promise<
  { ok: true; graph: TraceGraph } | { ok: false; exitCode: 2 | 3; message: string }>;
```

isExternal (Python): path contains `/site-packages/` or `/dist-packages/` or `/lib/python3.` or starts with `<` (e.g. `<frozen importlib._bootstrap>`, `<string>`, `<stdin>`).

---

### Task 1: Scaffold + toolchain green

**Files:** Create `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `grammars/tree-sitter-python.wasm`, `tests/smoke.test.ts`

- [ ] **Step 1: Write package.json** — name `crashpath`, `"type": "module"`, engines node ≥20, bin `./dist/cli/index.js`, deps `hono@^4`, `@hono/node-server@^1`, `web-tree-sitter@0.20.8`; devDeps `typescript@^5.5`, `vitest@^3`, `@biomejs/biome@^1.9`, `@types/node@^22`; scripts `build` (tsc + ui), `test` (vitest run), `lint` (biome check .), `typecheck` (tsc --noEmit), `corpus` (vitest run tests/corpus.test.ts).
- [ ] **Step 2: tsconfig** — module/moduleResolution NodeNext, target ES2022, strict, outDir dist, rootDir src, skipLibCheck, exclude ui/spike/demo/fixtures/tests from build; separate `tsconfig.test.json` including tests for typecheck.
- [ ] **Step 3: biome.json** — recommended rules, 2-space, 100 cols; ignore `dist`, `ui/dist`, `spike`, `fixtures`, `grammars`, `.playwright-mcp`.
- [ ] **Step 4: vitest.config.ts** — `test: { include: ["tests/**/*.test.ts"] }`.
- [ ] **Step 5: Vendor grammar** — `npm i` then copy `spike/node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm` → `grammars/`; remove `spike/package-lock.json` line from .gitignore is NOT needed (grammars are committed, spike stays ignored).
- [ ] **Step 6: smoke test** `tests/smoke.test.ts`: `expect(1+1).toBe(2)` → `npm test` green; `npm run lint` green; `npm run typecheck` green.
- [ ] **Step 7: Commit** `chore: scaffold crashpath package (tsc/biome/vitest/grammar)`

### Task 2: Port extract + parsers, corpus test green

**Files:** Create `src/parsers/types.ts`, `src/extract/index.ts`, `src/parsers/python.ts`, `src/parsers/v8.ts`, `tests/corpus.test.ts`, `tests/extract.test.ts`

Port `spike/parse.mjs` (proven 31/32) with these exact transformations — no behavior changes:
- Split: stage-1 helpers (`PREFIX_PATTERNS`, `stripPrefixes`, `cleanInput`, `walkStrings`, `TRACE_HINT`) + block scan loop → `src/extract/index.ts`; `parsePythonChain/Block`, `peekChainSeparator` + PY_ regexes → `src/parsers/python.ts`; `parseV8Block`, `parseAtLine`, `parseLoc` + V8_ regexes → `src/parsers/v8.ts`.
- Add types from `src/parsers/types.ts` to every signature; `Frame.isExternal` computed at parse time via the rule in the header (Python) and `node:`/`node_modules`/`internal/` (V8, port from spike golden hook heuristic: rawPath starts with `node:` or `internal/` or contains `/node_modules/`).
- V8 parser also ports the elision reconstruction (`... N lines matching cause stack trace ...`).
- The v8 port rides along now because extraction's block scanner is interleaved with both parsers; surgically stripping it costs more than porting it (Phase 2 owns its hardening).

- [ ] **Step 1: Write `tests/corpus.test.ts` (failing)** — port of `spike/corpus.mjs` comparison logic as vitest: for every `fixtures/traces/*.txt` with a `.golden.json`, run `extractTraces(text)`, compare first trace: exception.type exact, message lenient prefix, frames exact (rawPath/line/symbol; column & repeated when golden has them), chained recursive. Assert per-fixture with `it.each`. Additionally assert the aggregate: all 31 goldened fixtures pass and `17-py-pytest-default` yields 0 traces (documented gap).
- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../src/extract'`).
- [ ] **Step 3: Port the three modules** as described above.
- [ ] **Step 4: `npm test` → corpus green (31/31 + gap assertion), lint + typecheck green.**
- [ ] **Step 5: Write `tests/extract.test.ts`** — targeted §5.1 cases straight from fixtures: 19 (JSON-wrapped), 20 (CRI prefix), 31 (NestJS prefix), 32 (Azure prefix + orphan at-lines), 29 (celery: trace among log lines); assert language detection + block counts.
- [ ] **Step 6: Run all tests → green. Commit** `feat: extraction + python/v8 frame parsers (corpus 31/31)`

### Task 3: tree-sitter analyze (Python)

**Files:** Create `src/analyze/types.ts`, `src/analyze/treesitter.ts`, `src/analyze/python.ts`, `tests/analyze.test.ts`

`treesitter.ts`: memoized `Parser.init()`, `loadPython()` resolving `grammars/tree-sitter-python.wasm` via `new URL("../../grammars/…", import.meta.url)` (works from dist/). `python.ts`: iterative cursor walk collecting `function_definition` (+enclosing `class_definition` for qualifiedName `Class.method`, decorators from wrapping `decorated_definition` — record dotted decorator names like `app.get`), `class_definition`, `import_statement`/`import_from_statement`, `call` (callee = identifier or attribute last segment, record line + innermost enclosing function name). Skip files >2 MB (return empty analysis with `skipped: true`).

- [ ] **Step 1: Failing test** `tests/analyze.test.ts` — inline source string:

```python
from fastapi import FastAPI
app = FastAPI()

class OrderStore:
    def get(self, oid):
        return self._rows[oid]

@app.get("/orders/{oid}")
def read_order(oid: str):
    store = OrderStore()
    return store.get(oid)
```

Assert: symbols contain `OrderStore` (class, span 4–6), `OrderStore.get` (function, span 5–6), `read_order` (function, decorators `["app.get"]`); imports contain `fastapi`→`FastAPI` line 1; calls include `{calleeName:"get", line:11, enclosing:"read_order"}` and `{calleeName:"OrderStore", line:10, enclosing:"read_order"}`.
- [ ] **Step 2: Run — FAIL.  Step 3: Implement.  Step 4: green + lint/typecheck.**
- [ ] **Step 5: Commit** `feat: python tree-sitter analysis (symbols/imports/calls/decorators)`

### Task 4: Repo index + longest-suffix path matcher

**Files:** Create `src/resolve/repo.ts`, `tests/repo.test.ts`

`buildRepoIndex(root)`: `git -C root ls-files -z` (spawnSync, only if root is inside a git work tree) else bounded recursive walk skipping `node_modules/.venv/venv/dist/build/.git/__pycache__` (cap 20k files). Store posix-normalized relative paths. `matchPath`: normalize rawPath to posix, drop `file://`; compare path segments from the end; candidate score = number of matching trailing segments; keep max; tie → fewest segments total, still tied → lexicographically first + `ambiguous: true`. Reject score 0 or when only the basename matches ambiguously across >3 files.

- [ ] **Step 1: Failing tests** — temp dir via `fs.mkdtempSync`: files `app/main.py`, `app/routers/media.py`, `lib/media.py`. Assert: `/prod/box/app/routers/media.py` → `app/routers/media.py` (not ambiguous); `media.py` → ambiguous (two candidates, picks fewest-segments/lexicographic); `no/such/file.py` → null; `file:///x/app/main.py` → `app/main.py`; windows-style `C:\srv\app\main.py` → `app/main.py` (backslash normalization — CI matrix includes windows).
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green.**
- [ ] **Step 5: Commit** `feat: repo file index + longest-suffix frame path matching`

### Task 5: Frame → symbol resolver

**Files:** Create `src/resolve/index.ts`, `tests/resolve.test.ts`

`resolveTrace`: for each frame of the (chained-flattened) trace: skip `isExternal`; `matchPath` → miss = badge-less unresolved (file null); hit → lazily `analyzePythonFile` (memoized in the returned Map, cap 150 files); innermost symbol whose span contains line; name check = symbol.name equals frame.symbol OR last dotted segment OR frame.symbol `<module>` → file-level (symbol null, no badge). Line-hit + name-miss → resolve to enclosing symbol + badge `line-name-mismatch`. Ambiguous path → badge `ambiguous-path`. Frames keep original indices (chip grouping needs them).

- [ ] **Step 1: Failing test** — build a temp repo with the Task 3 source at `shop/api.py`; hand-build a ParsedTrace with frames `[{rawPath:"/srv/shop/api.py", line:11, symbol:"read_order"}, {rawPath:"/srv/shop/api.py", line:6, symbol:"get"}, {rawPath:"/usr/lib/python3.13/x.py", line:1, symbol:"ext", isExternal:true}]`. Assert: frame0 → symbol `read_order` no badges; frame1 → `OrderStore.get`; external frame untouched (file null, no analysis attempted); drifted line (line:2, symbol:"read_order") → enclosing resolution + `line-name-mismatch` badge.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green.**
- [ ] **Step 5: Commit** `feat: frame→symbol resolution with drift/ambiguity badges`

### Task 6: Graph builder + demo fixture app

**Files:** Create `src/graph/types.ts` (§5.9 verbatim), `src/graph/build.ts`, `demo/python/{app.py,services.py,store.py,README.md,trace.txt}`, `tests/graph.test.ts`

`buildGraph`: spine = resolved frames in order; runs of consecutive external frames collapse into one `external-chip` node (name = top package dir e.g. `starlette ×14`, `collapsedFrames` filled); node ids = sha1(file+qualifiedName) or `chip:<i>`/`unresolved:<i>`; `trace` edges connect consecutive spine nodes; `contains` edges file→class→function for analyzed files; `import`/`call` edges among analyzed files only, `call` emitted only on unique name resolution (§5.6); crash = last spine node; chained traces → `TraceGraph.chained[]`. Meta: `resolvedFrames/totalFrames/language/repo`.

demo/python: mini FastAPI "shop" (source-only): `store.py` (`CATALOG` dict + `get_product`), `services.py` (`price_with_tax` calling store), `app.py` (`@app.get("/products/{pid}")` route calling services; crash = KeyError on unknown pid). `trace.txt`: real traceback pre-recorded once via the Phase-0 venv (uvicorn TestClient run), paths sanitized to `/home/dev/shop/...` — the suffix matcher resolves them against `demo/python`. Record with `python -X no_debug_ranges` OFF (keep 3.13 anchors — they exercise the parser).

- [ ] **Step 1: Create demo app files** (three modules above, ~45 lines total, deliberate `KeyError: 'sku-404'`).
- [ ] **Step 2: Record `demo/python/trace.txt`** using the Phase-0 scratch venv + a tiny TestClient script (throwaway, not committed); sanitize prefix → `/home/dev/shop`; verify it contains ≥3 in-repo frames + fastapi/starlette external runs.
- [ ] **Step 3: Failing test** `tests/graph.test.ts` — run full chain (extract→resolve→build) on `demo/python/trace.txt` against repo root `demo/python`: assert crash node is `read_product`-equivalent with `crash: true`; spine length = printed frames minus collapsed runs; ≥1 external chip with `collapsedFrames.length ≥ 2`; every consecutive spine pair has a `trace` edge; `meta.resolvedFrames ≥ 3`; graph JSON round-trips `JSON.parse(JSON.stringify(g))`.
- [ ] **Step 4: FAIL → implement → green.**
- [ ] **Step 5: Commit** `feat: trace graph builder + bundled python demo fixture`

### Task 7: pipeline + CLI (--json, exit codes)

**Files:** Create `src/pipeline.ts`, `src/cli/index.ts`, `tests/cli.test.ts`

`pipeline.ts`: compose stages; no traces → `{ok:false, exitCode:2, message}` listing the anchors searched (verbatim §5.1 patterns); traces but 0 in-repo resolved frames → `{ok:false, exitCode:3, message}` with top 5 unresolved rawPaths. CLI (`node:util` parseArgs): flags `-t/--trace`, `-r/--repo` (default cwd, walk up to `.git`), `--json`, `--port`, `--no-open`, subcommand `demo [python]`; stdin read when piped (`!process.stdin.isTTY`); `--json` prints graph and exits; otherwise starts server (Task 8). Shebang `#!/usr/bin/env node`.

- [ ] **Step 1: Failing tests** — spawn `node dist/cli/index.js` (after `tsc`): (a) `--json -t demo/python/trace.txt -r demo/python` → exit 0, stdout parses as TraceGraph with `meta.language === "python"`; (b) `-t /dev/null`-equivalent empty file → exit 2, stderr mentions `Traceback (most recent call last)`; (c) `--json -t demo/python/trace.txt -r <empty tmpdir>` → exit 3, stderr lists `/home/dev/shop/app.py`. Tests build first via `execSync("npm run typecheck && tsc -p tsconfig.json")` in `beforeAll` (30s timeout).
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green.**
- [ ] **Step 5: Commit** `feat: crashpath CLI with --json contract and exit codes 2/3`

### Task 8: Local server

**Files:** Create `src/server/index.ts`, `tests/server.test.ts`

hono on `@hono/node-server`, host 127.0.0.1, port 0 (random) unless `--port`. Routes: `GET /api/graph` (current graph or 404), `POST /api/trace` `{text}` → run pipeline, store as current, return graph (400 on exit-2 semantics, 422 on exit-3 with message), `GET /api/source?file=<repo-rel>&around=<line>` → realpath must start with realpath(repoRoot) else 403; returns `{file, start, lines: string[], focus}` ±10 lines; dotfile paths outside repo denied by the same rule. Serves `dist/ui` statics at `/` when present.

- [ ] **Step 1: Failing tests** — start server on ephemeral port against `demo/python`: POST trace.txt text → 200 graph JSON; GET /api/source?file=app.py&around=12 → 200 with focus line text; `file=../../etc/hosts` and `file=/etc/hosts` → 403; POST garbage text → 400 with anchors message.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green.**
- [ ] **Step 5: Commit** `feat: local hono server (graph/trace/source, sandboxed)`

### Task 9: UI — paste box, spine, code panel, legend

**Files:** Create `ui/` (Vite React TS + Tailwind), components `ui/src/{App,api,layout}.tsx|ts`, `ui/src/components/{PasteBox,GraphView,SpineNode,ChipNode,SidePanel,Legend}.tsx`

Visual system: port tokens from `spike/mock/spine.html` (bg `#0B0E1A`, board `#0E1222`, dot-grid, hot `#FF4D5E`, static `#4A5378`, ghost `#B388FF` (legend entry only in Phase 1), node `#1A2138`/`#39415F`, text `#E8EAF6`/`#8B93B8`; IBM Plex Mono for evidence / Space Grotesk for chrome, self-hosted via `@fontsource`, no CDN). Layout is a pure function `layoutGraph(graph): {nodes: PlacedNode[], edges: PlacedEdge[], width, height}` — spine x = index·125, chips pill-width, crash emphasized — unit-testable without DOM. States: empty (PasteBox → POST /api/trace), rendered (GraphView + SidePanel on node click, ←/→ walks spine, Enter opens panel), error toasts from 400/422. Draw-on animation (1.2s, respects `prefers-reduced-motion`).

- [ ] **Step 1: Scaffold `ui/`** — `npm create vite@latest` (react-ts), Tailwind v4, `@fontsource/ibm-plex-mono`, `@fontsource/space-grotesk`; vite `build.outDir: "../dist/ui"`, `emptyOutDir: true`, dev proxy `/api` → `http://127.0.0.1:7411` (fixed dev port).
- [ ] **Step 2: Failing test (vitest in ui)** for `layoutGraph`: feed the Task 6 demo graph JSON (checked-in snapshot `ui/src/__fixtures__/demo-graph.json`, regenerated by `npm run corpus` script step — regenerate via CLI `--json`); assert: spine placed left→right in frameIndex order, chip nodes present, crash node flagged, edge endpoints connect adjacent columns.
- [ ] **Step 3: FAIL → implement layout + components → ui tests green.**
- [ ] **Step 4: Wire root `npm run build`** to build ui into `dist/ui`; `crashpath -t demo/python/trace.txt -r demo/python --no-open` then manual check `curl localhost:<port>` serves HTML; screenshot via playwright MCP for the PR/report.
- [ ] **Step 5: Commit** `feat: spine UI (paste, graph, code panel, legend)`

### Task 10: demo command + first-render performance

**Files:** Modify `src/cli/index.ts` (demo subcommand), Create `tests/demo.test.ts`

`crashpath demo python` (default `python`): repoRoot = packaged `demo/python` (resolve via `new URL("../../demo/python", import.meta.url)`), trace = its `trace.txt`, then normal server path + auto-open (skip with `--no-open`).

- [ ] **Step 1: Failing test** — spawn `node dist/cli/index.js demo python --no-open --port 0`, poll stdout for `crashpath: http://127.0.0.1:<port>`, then `GET /api/graph` → 200 with `meta.resolvedFrames ≥ 3`; **assert elapsed spawn→200 < 5000 ms** (the §7 acceptance bar).
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: green.**
- [ ] **Step 5: Commit** `feat: crashpath demo python (bundled, <5s to first graph)`

### Task 11: Playwright smoke (ubuntu-only in CI)

**Files:** Create `e2e/smoke.spec.ts`, `playwright.config.ts`

- [ ] **Step 1: Spec** — start `demo python --no-open`, page.goto(url): expect ≥6 spine nodes rendered (`[data-node]`), click crash node → side panel shows `app.py` and the focus line text, legend visible.
- [ ] **Step 2: Run locally (`npx playwright test`) → green.**
- [ ] **Step 3: Commit** `test: e2e demo smoke`

### Task 12: CI + repo CLAUDE.md

**Files:** Create `.github/workflows/ci.yml`, `CLAUDE.md`

- [ ] **Step 1: ci.yml** — matrix `os: [ubuntu-latest, macos-latest, windows-latest]`, node 20: `npm ci` (root + ui), `npm run lint`, `npm run typecheck`, `tsc -p tsconfig.json`, `npm test`, `npm run build`; separate ubuntu job: playwright install chromium + `npx playwright test`. Cache npm.
- [ ] **Step 2: CLAUDE.md** (§10 guardrails): biome + vitest commands; **never modify `fixtures/traces/**` without explicit human approval**; UI changes require a screenshot in the PR/report; corpus + gate metrics are the definition of done; no new runtime deps without discussion; conventional commits.
- [ ] **Step 3: Push branch, verify Actions green on all 3 OS** (visible after user pushes/sets up repo; locally run the same commands as a proxy).
- [ ] **Step 4: Commit** `ci: 3-OS matrix + e2e smoke; add repo CLAUDE.md`

## Self-Review

- **Spec coverage:** Flow A (paste) T8+T9; Flow B (pipe/-t) T7; Flow C (demo) T10; `--json` T7; exit codes T7; §5.1–5.6 T2–T6; §5.9 schema T6; §5.13 sandbox T8; UI spec (§3.3 minus Phase-3 items) T9; acceptance trio T10 (<5s), T2 (corpus), T12 (CI). Ghost edges, blast radius, `--ref`, exports, sourcemaps, MCP, AI: explicitly Phase 2/3/4 — out.
- **Placeholder scan:** port-tasks reference exact spike files + exact transformations; new-logic tasks embed code/tests. No TBDs.
- **Type consistency:** `extractTraces` returns `ParsedTrace[]` with `language` folded in (T2 signature) — consumed by T5/T6/T7 as written; `ResolvedFrame.frameIndex` feeds chip grouping in T6. Checked.
