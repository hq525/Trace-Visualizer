# tracemap — plan.md

> **Working title:** `tracemap` (verify npm/GitHub availability before scaffolding — see §10. Alternates: `crashpath`, `stackscope`, `faultline`.)
> **NAME DECIDED 2026-07-11: `crashpath`** — npm free, no GitHub squatting. All new code/package/CLI use `crashpath`; "tracemap" below is the historical working title.
>
> **One-liner:** Paste a raw stack trace → see the failure as an animated path through your codebase graph. Post-mortem, local-first, zero setup.
>
> **This document is the single source of truth for Claude Code. Read fully before writing any code. Respect the guardrails in CLAUDE.md. Every phase has acceptance gates — do not proceed past a failed gate without explicit human sign-off.**

---

## 0. Elevator pitch

Every codebase visualizer fails the same way: it renders *everything* (unreadable hairball), goes stale immediately, and gives you no reason to open it twice. Every AI trace-explainer fails the opposite way: text-only, no spatial context, commoditized by ChatGPT.

`tracemap` fuses the two. A stack trace is a **principled filter** over the codebase — it selects the ~10 functions that matter *right now*. We parse the repo lazily (only files the trace touches), build a ground-truth graph with tree-sitter, overlay the runtime failure path on it, and render an interactive local UI. The trace is runtime *fact*; static edges are parsed *evidence*; AI commentary is clearly-labeled *inference*. Nobody else separates these layers.

**Target user moment:** staring at a traceback from CI, production logs, or a bug report — no live process to attach a debugger to. Visual Studio Enterprise Code Map and the CBRV extension only work with a live debug session. The post-mortem case is unserved.

**North star for every decision:** `npx tracemap` → paste → rendered graph in under 60 seconds, on a machine with nothing installed but Node, with no API key, offline.

---

## 1. Goals & non-goals

### 1.1 Goals
1. **G1 — Instant demo:** `npx tracemap demo` produces a beautiful rendered failure path with zero configuration.
2. **G2 — Real-world robustness:** correctly parses ≥90% of a corpus of 30+ real, ugly traces (log-prefixed, JSON-wrapped, truncated, chained).
3. **G3 — Ground-truth graph:** every edge in the graph is either runtime fact (trace) or statically parsed (tree-sitter). AI never draws graph structure.
4. **G4 — Two languages done excellently:** Python + TypeScript/JavaScript (incl. sourcemap resolution). Plugin interface for community-contributed languages.
5. **G5 — Portfolio & launch quality:** clean architecture, tests, CI, docs — code an interviewer can read. Launch assets (GIF, README, Show HN post) are in-scope deliverables, not afterthoughts.

### 1.2 Non-goals (hard scope fence — reject feature creep against this list)
- ❌ No whole-repo indexing, wiki generation, or documentation output (DeepWiki's territory).
- ❌ No Mermaid anywhere in the pipeline.
- ❌ No database, no Docker, no daemon, no SaaS/hosted version, no telemetry.
- ❌ No more than 2 languages in v1. No Java/Go/Rust until the plugin interface exists and is proven.
- ❌ No live-debugger integration (DAP), no IDE extension in v1.
- ❌ No type-inference-grade call graph (that treadmill killed Sourcetrail). Name-based resolution, honestly labeled.
- ❌ No AI-required features. Everything core works offline with no key.

### 1.3 Success metrics
| Metric | Bar |
|---|---|
| Phase 0 spike gates | See §7 — hard kill/rescope criteria |
| Parse rate on real-trace corpus | ≥90% of traces produce a complete frame list |
| Frame→symbol resolution | ≥80% of in-repo frames resolve to the correct function node |
| Time-to-first-render | <60s from `npx` on cold cache; <5s on a warm repo |
| Launch | Show HN attempt + ≥3 newsletter submissions + MCP directory listing |
| Stars | 1,000 = success. Not a growth business; a portfolio asset. |
| Timebox | **6 weekends total.** Feature freeze before launch weekend. This must not cannibalize interview-prep hours. |

---

## 2. Design rationale — competitor pain → feature mapping

This section justifies every major design decision against documented failures of existing OSS tools. Reproduce a condensed version of this table in the README ("Why another code visualizer?") and in the launch post.

| # | Documented pain in existing tools | Evidence | tracemap design answer |
|---|---|---|---|
| P1 | **Large repos break everything.** deepwiki-open: LLM context-length errors, 20+ min jobs killed by 5-min timeouts, big-repo socket timeouts. DeepWiki (paid) requires manual `wiki.json` to cope. | deepwiki-open issues #468, #109; PR #273; Devin docs | **Trace-as-filter + lazy parsing.** Only parse files reachable from trace frames (typically <50 files, even in monorepos). No whole-repo pass exists anywhere in the pipeline. LLM payload (optional) is ~10 frames + snippets ≈ 3–5k tokens. |
| P2 | **Diagrams aren't ground truth.** GitDiagram infers architecture from file tree + README via two LLM passes. deepwiki-open output quality varies; AI misreads complex logic. Users can't tell real edges from hallucinated ones. | GitDiagram README; deepwiki-open reviews | **Visual epistemology.** Three layers with distinct rendering: trace path (runtime fact, solid red), static edges (tree-sitter parsed, solid grey), AI commentary (badged, side-panel only, never graph structure). |
| P3 | **Mermaid is the rendering ceiling.** Uncontrollable layout, broken tooltips/links, characters that error out; LLM-generated Mermaid needs validators and retries. | Mermaid/GitHub docs; both tools ship validators | **Custom SVG renderer.** React + deterministic spine layout. Nothing LLM-generated touches the render path, so nothing can be syntactically invalid. Full interactivity: click-to-source, hover, animation. |
| P4 | **Setup friction & cost.** Docker + API keys + GPU for Ollama (deepwiki-open); Memgraph/Neo4j for graph tools; token bills on large repos. | deepwiki-open docs/reviews; Graph-Code/codegraph setup | **`npx tracemap`. Nothing else.** No key, no container, no DB, fully offline core. AI optional via BYO key or Ollama — and payloads are small enough for a 3B local model. |
| P5 | **The per-language indexer treadmill killed Sourcetrail** (pinned-LLVM C++ indexer, JNI Java indexer, cross-platform maintenance collapse). | Sourcetrail discontinuation post | **Community tree-sitter WASM grammars + ~200-line frame parsers per language.** Publish `FrameParser` + `LanguageAnalyzer` plugin interfaces so contributors add languages at 1% of Sourcetrail's per-language cost. |
| P6 | **Static analysis can't see runtime dispatch** (decorators, DI, middleware, dynamic import) — exactly where bugs hide. Tools with runtime data (VS Code Map, CBRV) require a *live* debugger session. | CBRV docs; VS docs | **Ghost edges — the flagship feature.** The trace *is* runtime truth. When consecutive frames have no static edge between them, render a distinct "ghost" hop and (optionally) let AI explain the mechanism. Turns the universal weakness into our differentiator. |
| P7 | **Staleness.** Generated wikis / committed graph JSONs drift from code immediately; regeneration is slow/expensive. Prod trace line numbers rarely match current HEAD — unacknowledged by every tool. | Understand-Anything workflow; universal experience | **Ephemeral per-incident artifact** built from the working tree — nothing to go stale. Plus `--ref <sha|tag>`: git-worktree checkout of the exact version that crashed, so line numbers align. |
| P8 | **No recurring reason to open the tool.** Structure-oriented wikis get read once at onboarding. | Category-wide | **Task-anchored.** The tool opens *because something crashed* — a recurring event — and answers "where, and what's around it" immediately. |

---

## 3. Product spec

### 3.1 Core user flows

**Flow A — paste (primary):**
```
$ cd my-repo && npx tracemap
→ opens http://127.0.0.1:<port> with a paste box
→ user pastes traceback / log blob
→ UI renders failure path within ~3s
```

**Flow B — pipe / file:**
```
$ pytest 2>&1 | npx tracemap
$ npx tracemap -t error.log
$ npx tracemap -r ../other-repo -t trace.txt --ref v1.4.2
```

**Flow C — demo (launch-critical):**
```
$ npx tracemap demo            # bundled sample repo + real trace, zero deps
$ npx tracemap demo node
```

**Flow D — export & share:**
```
$ npx tracemap export -t trace.txt -o failure.html   # single self-contained file → attach to GitHub issue / Jira
$ npx tracemap export -t trace.txt -o failure.svg
```

**Flow E — agent (MCP):**
```
$ claude mcp add tracemap -- npx tracemap mcp
→ agent calls map_trace(trace_text) mid-debug, gets URL + structured summary
```

### 3.2 CLI interface

```
tracemap [options]                 Start UI (paste mode) for repo at cwd
tracemap demo [python|node]        Bundled demo, zero configuration
tracemap export -t <file> -o <out> Render to standalone .html or .svg
tracemap mcp                       Run as MCP stdio server

Options:
  -t, --trace <file>      Read trace/log from file (or pipe via stdin)
  -r, --repo <path>       Repo root (default: cwd; walks up to nearest .git)
  --ref <git-ref>         Analyze the code version that crashed (git worktree)
  --ai <provider>         anthropic | openai | ollama (default: off)
  --model <name>          Override provider default model
  --max-radius <n>        Blast-radius parse cap (default: 100 files)
  --port <n>              Fixed port (default: random free port on 127.0.0.1)
  --no-open               Don't auto-open browser
  --json                  Print graph JSON to stdout and exit (CI / scripting)
```

Conventions: exit 0 on success; exit 2 "no trace found in input" with a helpful message showing what anchors we looked for; exit 3 "no frames resolved to this repo" with the top unresolved paths listed (likely wrong `--repo`).

### 3.3 UI spec

**Layout (dark theme default — developer audience, better GIF):**
- **Header:** exception type + message, repo name, ref badge if `--ref` used. Chained exceptions render as vertically stacked linked paths with "caused by" / "during handling of" connectors.
- **Main canvas (SVG):** left→right spine of trace-path nodes ordered root-call → crash. Crash node emphasized (red fill, subtle pulse). Frame index badges. External frames (site-packages / node_modules / node:internal) collapsed into compact grey chips — click to expand the run of external frames.
- **Blast radius:** 1-hop callers/callees at reduced opacity around the spine. Toggle in toolbar (default ON, auto-OFF above 120 rendered nodes).
- **Edge legend (always visible):** ▬ red = runtime trace hop · ▬ grey = static call/import (parsed) · ⤳ dashed violet = ghost edge (runtime hop with no static edge — dynamic dispatch) · containment shown by grouping, not edges.
- **Side panel (on node click):** file path (click-to-copy), source snippet ±10 lines with the frame line highlighted, symbol kind, in/out edges list. Keyboard: ←/→ walk the spine, Enter opens panel.
- **AI panel (only when `--ai`):** clearly badged "AI inference". Root-cause hypothesis, per-hop notes (surfaced on node hover), ghost-edge explanations, suggested fix as a description + optional unified diff. Regenerate button.
- **Toolbar:** blast-radius toggle · ghost-edges-only filter · export PNG (client-side SVG→canvas) · copy shareable HTML.
- **Performance caps:** ≤150 rendered nodes; beyond that, radius trimmed by degree; virtualized code panel.

Apply the frontend-design skill when building the UI phase — the GIF *is* the marketing.

### 3.4 AI layer (strictly optional)

- Providers: Anthropic / OpenAI / Ollama. Keys via `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OLLAMA_HOST`. Direct `fetch` calls — no heavy SDKs.
- Input: exception + message, resolved frames each with a ±5-line snippet, ghost-edge list, blast-radius symbol names. Budget ≈ 3–5k tokens.
- Output: strict JSON (schema in Appendix A). Rendered only in the AI panel. **Never mutates graph structure** (enforced by type: AI output has no node/edge fields).
- Failure mode: AI errors degrade to a dismissible toast; core UI unaffected.

### 3.5 MCP server

`tracemap mcp` — stdio transport, `@modelcontextprotocol/sdk`.

Tools:
1. `map_trace(trace_text: string, repo_path?: string, ref?: string)` → `{ url, exception, crash: {file, line, symbol}, frames_resolved, frames_total, ghost_edges: [{from, to}], radius_summary: string }`. Starts (or reuses) the local server, returns the URL for the human plus a structured summary the agent can reason over.
2. `export_trace_map(trace_text, format: "html"|"svg", repo_path?)` → `{ file_path }`.

This is a distribution channel (MCP directories, awesome-mcp-servers) as much as a feature. One weekend max.

---

## 4. Architecture

### 4.1 Pipeline

```
raw text ──▶ extract ──▶ parse frames ──▶ [sourcemap] ──▶ resolve to repo ──▶ lazy analyze ──▶ build graph ──▶ serve/render
            (find trace   (per-language    (JS only)       (path matching +    (tree-sitter     (nodes, edges,   (local HTTP +
             blocks in     regex parsers,                   symbol lookup)      on touched       ghost, radius)    React SVG UI)
             dirty logs)   normalize dir.)                                      files only)
                                                                                      │
                                                                              [--ref: git worktree]
                                                                                      │
                                                                              [--ai: annotate] ──▶ AI panel only
```

Every stage is a pure function with a serializable output → unit-testable with golden fixtures.

### 4.2 Tech stack (with rationale)

| Choice | What | Why |
|---|---|---|
| Language | TypeScript end-to-end, Node ≥ 20, ESM | Single runtime → `npx` distribution (the friction goal). Matches maintainer's primary stack. |
| Parsing | `web-tree-sitter` (WASM) + grammar `.wasm` files bundled: python, typescript, tsx, javascript | No native compilation → no cross-platform build support burden (the Sourcetrail trap). Lazy-load grammars per language. Accept ~8–12 MB package. |
| Layout | **Custom deterministic spine layout** (frame index → x-column; radius nodes placed in columns adjacent to their anchor). Evaluate `elkjs` for radius placement in Phase 3 *only if* the custom layout looks cramped. | A trace is a path — layered left→right beats force-directed hairballs. Deterministic layout = stable GIFs, stable tests, no layout-engine fights. |
| UI | React 18 + Vite + Tailwind, pure SVG (not canvas) | Crisp text, native click targets, trivial SVG export. Built to static assets, embedded in the npm package. |
| Server | `hono` on `node:http`, bound to 127.0.0.1 | Tiny; serves UI assets + `/api/graph` + `/api/source`. |
| Sourcemaps | `source-map-js` | Battle-tested `originalPositionFor`. |
| Git | shell out to `git` (`worktree`, `grep`) with graceful fallback when absent | Zero deps; `git grep` is the fastest caller-discovery scan available. |
| Tests | `vitest` + fixture corpus; Playwright smoke test for the UI | |
| Lint/format | `biome` | One tool, fast. |
| CI | GitHub Actions: lint, typecheck, test, build on ubuntu/macos/windows matrix | Windows must work for star-audience credibility; WASM makes this cheap. |
| License | MIT | |

### 4.3 Repository structure

```
tracemap/
├── src/
│   ├── cli/            # arg parsing, subcommands, stdin handling
│   ├── extract/        # dirty text → RawTrace[]  (§5.1)
│   ├── parsers/        # python.ts, v8.ts, types.ts (FrameParser plugin iface)
│   ├── sourcemap/      # dist/*.js frames → original TS source (§5.3)
│   ├── analyze/        # tree-sitter loader, per-language queries, symbol tables
│   ├── resolve/        # frame → repo file → symbol node (§5.5)
│   ├── graph/          # schema, builder, ghost edges, blast radius (§5.6–5.9)
│   ├── gitref/         # --ref worktree management (§5.10)
│   ├── server/         # hono app, source-file sandboxing
│   ├── ai/             # provider clients, prompt, JSON schema validation
│   └── mcp/            # MCP stdio server
├── ui/                 # Vite React app → built into dist/ui at publish
├── fixtures/
│   ├── traces/         # 30+ real traces + golden parse JSON (§6)
│   └── repos/          # mini Python + TS apps with deliberate bugs
├── demo/               # bundled demo repos + pre-recorded traces
├── docs/               # architecture.md, adding-a-language.md
└── .github/workflows/
```

---

## 5. Technical specifications

### 5.1 Trace extraction from dirty input (`extract/`)

Real-world input is never a clean traceback. Handle, in order:

1. **JSON-wrapped log lines** — attempt `JSON.parse` per line; if a parsed object has a string field containing `\n`-escaped trace content (common keys: `message`, `msg`, `stack`, `error`, `exc_info`), unescape and inline it.
2. **Log-prefix stripping** — strip leading `2026-07-11T…`, `[ERROR]`, `ERROR:root:`, syslog/k8s prefixes via a prefix-detection pass (find the longest common timestamp/level prefix across consecutive lines, remove it).
3. **Block detection via anchors:**
   - Python: line matching `^Traceback \(most recent call last\):` → consume until the exception line `^\w[\w.]*(Error|Exception|Warning|Exit)?\b.*` followed by a non-indented line; include chained blocks joined by the two chain separators (§5.11).
   - V8: line matching `^[A-Za-z_$][\w$]*(Error|Exception)?: ` (or `Uncaught …`) followed by ≥1 `^\s+at ` lines → consume the `at` run.
4. **Multiple traces in one blob** → return `RawTrace[]`; UI shows a trace picker (grouped by exception signature) when >1 found. Dedupe identical signatures with a ×N count.
5. Nothing found → exit 2 with the anchor patterns we searched for.

Output: `RawTrace { language: 'python'|'js'|'unknown', text: string, sourceRange: [start,end] }`.

### 5.2 Frame parsers (`parsers/`) — plugin interface

```ts
interface FrameParser {
  language: 'python' | 'js';
  matches(raw: RawTrace): boolean;
  parse(raw: RawTrace): ParsedTrace;   // throws ParseError with context
}
interface ParsedTrace {
  exception: { type: string; message: string };
  frames: Frame[];               // ALWAYS normalized root-call → crash order
  chained?: { relation: 'cause' | 'context'; trace: ParsedTrace };
}
interface Frame {
  rawPath: string; line: number; column?: number;
  symbol?: string;               // function/method name as printed
  isExternal: boolean;           // stdlib / site-packages / node_modules / node:internal
  sourceLine?: string;           // the code line printed under Python frames
  repeated?: number;             // "[Previous line repeated N more times]"
}
```

**Python parser — must handle:**
- Standard frames: `  File "path", line N, in name` + optional source line.
- **Direction:** Python prints root→crash ("most recent call last") — already normalized order.
- Python 3.11+ `~~~^^^` anchor decoration lines under source lines → skip.
- `[Previous line repeated N more times]` → set `repeated`.
- `<frozen importlib._bootstrap>`, `<string>`, `<stdin>` → `isExternal: true`.
- External heuristic: path contains `/site-packages/`, `/dist-packages/`, or matches stdlib prefix (path under `sys.prefix`-like dirs — heuristic: contains `/lib/python3.`).
- `SyntaxError` (no call chain — File/line + caret): render single-node path; don't crash.
- Multiline exception messages (consume until dedent/blank).
- Stretch (Phase 3, behind a fixture): `ExceptionGroup` sub-traces with `| ` prefixes — strip prefix, parse recursively; if unimplemented, degrade to first sub-trace + warning banner.

**V8/Node parser — must handle:**
- `    at fn (path:line:col)` · `    at path:line:col` (anonymous) · `at async fn (…)` · `at new Class (…)` · `at Object.method` / `at Class.method` (keep full dotted symbol, match on last segment).
- **Direction:** V8 prints crash-first → **reverse to normalize** root→crash.
- `node:internal/…`, `internal/…`, `/node_modules/` → external.
- `file:///` URLs → strip scheme. `webpack://…` and `eval at …` → mark external-unresolvable, keep visible as chips.
- Browser variants (Chrome format ≅ Node; defer Firefox/Safari formats to community plugins — document in adding-a-language.md).
- Stretch: `[cause]:` chain blocks (Node ≥16.9) → `chained { relation: 'cause' }`.

Golden-test every bullet above with a real fixture (§6).

### 5.3 Sourcemap resolution (`sourcemap/`) — JS/TS only

For each non-external frame whose `rawPath` resolves to a file inside the repo that is generated (`dist/`, `build/`, `.next/`, or contains `//# sourceMappingURL=`):
1. Locate map: inline data-URL, adjacent `<file>.map`, or the `sourceMappingURL` path.
2. `originalPositionFor({line, column})` → original `source`, `line`, `name`.
3. Rewrite the frame; keep `mappedFrom: rawPath` for display ("via dist/server.js:1:4823").
4. Missing/broken map → keep compiled frame, badge it "no sourcemap" in UI. Never fail the pipeline.

### 5.4 Lazy repo analysis (`analyze/`)

- Load `web-tree-sitter` + only the grammars needed for detected trace language(s).
- Parse **only**: (a) files that trace frames resolve into, (b) files those import (1 level, for call-edge targets), (c) caller-candidate files from §5.8. Global caps: ≤ `--max-radius` (100) candidate files, ≤150 parsed total, ≤2 MB per file (skip larger with a warning).
- Per-language tree-sitter queries extract:
  - Python: `function_definition`, `class_definition`, `decorated_definition` (record decorator names — feeds ghost-edge labeling), `import_statement`/`import_from_statement`, `call` expressions.
  - TS/JS: `function_declaration`, `method_definition`, class fields with arrow functions, `variable_declarator` = arrow/function expression, `class_declaration`, `import_statement` (+ `require()` calls), `call_expression`.
- Build per-file symbol tables: `{name, qualifiedName, kind, span, decorators[]}`.
- Import resolution: relative paths exactly; Python package roots by walking `__init__.py`; TS path aliases via `tsconfig.json#paths` best-effort (Phase 2.5; skip silently if absent). Unresolvable imports are dropped, never fatal.

### 5.5 Frame → symbol resolution (`resolve/`)

1. **Path matching:** trace paths are often absolute from *another machine* (prod). Match by **longest path-suffix** against the repo file list (built via `git ls-files` when available, else bounded walk skipping `node_modules/.venv/dist/build/.git`). Ties → prefer fewer directory hops from repo root; still ambiguous → pick first, badge "ambiguous path" in UI.
2. **Symbol lookup:** in the parsed file, find the innermost function-like node whose span contains `frame.line`; verify `frame.symbol` matches its name (exact, or last dotted segment, or Python `<locals>` qualname suffix). Line matches but name doesn't (drifted code) → resolve to enclosing node, badge "line/name mismatch — code may have changed since this trace (try --ref)".
3. Module-level frames (`in <module>`) → resolve to the file node.
4. Unresolved in-repo frames stay on the spine as grey "unresolved" nodes — the path must never have holes.

**Resolution rate is the product.** Instrument it: log `resolved/total` per run; it's a Phase 0 gate metric.

### 5.6 Static edge extraction — precision philosophy

State this in docs/README verbatim: *"The red path is exact — it's what actually executed. Grey edges are best-effort static context. Where the runtime path used an edge we couldn't find statically, you'll see a ghost edge — that's not a bug, that's dynamic dispatch made visible."*

- `contains`: file → class → function (rendered as grouping, not arrows).
- `import`: file → file.
- `call`: within analyzed files only. Resolve a `call_expression` callee name against: same-file symbols → explicitly imported symbols → method calls matched by name on last segment. **Emit the edge only when exactly one candidate matches; otherwise skip.** No type inference, ever (non-goal §1.2).

### 5.7 Ghost edges (flagship)

For each consecutive resolved pair on the spine `frame[i] → frame[i+1]` (both in-repo): if no static `call` edge exists from node(i) (or anything it contains) to node(i+1), emit `ghost` edge. Attach cheap classification hints, in priority order: callee has decorators (`@app.route`, `@task`, …) → "decorator-dispatched"; hop crosses an external-chip boundary → "through framework/library"; callee is imported dynamically (`importlib`, `import()`) → "dynamic import"; else "dynamic dispatch". AI (if enabled) upgrades the hint to a proper explanation. Ghost edges get their own toolbar filter — "show me only the magic" is a demo moment.

### 5.8 Blast radius (1-hop)

- **Callees:** static call edges out of spine nodes (already parsed).
- **Callers:** `git grep -nwF <symbol>` per spine symbol (fallback: bounded fs scan) → candidate files → parse (respecting caps §5.4) → keep files containing a `call` that uniquely resolves to the spine symbol. Sort candidates by symbol-name specificity (skip caller-search for names <4 chars or on a stoplist: `get, run, main, init, handler, process, update, create, delete` — too noisy).
- Rendered at 40% opacity, capped at 60 radius nodes by degree.

### 5.9 Graph schema (`graph/`)

```ts
type NodeKind = 'function' | 'class' | 'file' | 'external-chip' | 'unresolved';
interface GraphNode {
  id: string;                    // stable hash(file + qualifiedName)
  kind: NodeKind; name: string; qualifiedName?: string;
  file?: string; span?: [startLine, endLine];
  onSpine: boolean; frameIndex?: number;      // position on trace path
  crash?: boolean;                             // last frame
  badges: Array<'ambiguous-path'|'line-name-mismatch'|'no-sourcemap'|'via-sourcemap'>;
  collapsedFrames?: Frame[];                   // for external chips
}
interface GraphEdge {
  id: string; from: string; to: string;
  kind: 'trace' | 'call' | 'import' | 'ghost';
  evidence: 'runtime' | 'static';              // ghost = runtime; AI never adds edges
  ghostHint?: string;
}
interface TraceGraph {
  exception: {type: string; message: string};
  chained?: Array<{relation: 'cause'|'context'; graph: TraceGraph}>;
  nodes: GraphNode[]; edges: GraphEdge[];
  meta: { repo: string; ref?: string; resolvedFrames: number; totalFrames: number; language: string };
}
```
`--json` dumps exactly this. It is the API contract for the UI, exports, MCP, and tests.

### 5.10 `--ref` (git worktree)

`git worktree add <tmpdir> <ref>` → run the whole pipeline against the worktree → `git worktree remove` on exit (and on SIGINT; also GC stale `tracemap-*` worktrees >24h old on startup). Dirty-tree HEAD is fine — worktree only used when `--ref` given. Not a git repo + `--ref` → exit with clear error. UI shows a ref badge.

### 5.11 Chained exceptions / multi-trace

- Python separators: `During handling of the above exception, another exception occurred:` (relation `context`) and `The above exception was the direct cause of the following exception:` (relation `cause`). Build linked `ParsedTrace`s; render stacked spines with labeled connectors, newest on top.
- Multiple *independent* traces in one log → picker UI (§5.1), signature = `exceptionType + normalized top in-repo frame`.

### 5.12 Layout & rendering

Deterministic spine layout (no external layout engine in v1):
- Spine node x = `frameIndex * COL_W`, y = spine row. Consecutive external frames collapse into one chip occupying one column.
- Radius nodes stack above (callers) / below (callees) their anchor column, nearest-first; overflow gets a "+N more" expander.
- Chained traces stack vertically with 1.5× row gap.
- Edges: orthogonal rounded routing for spine; quadratic curves for radius; ghost = dashed + distinct color + small ⚡ glyph.
- Entry animation: path draws left→right over ~1.2s (once, respects `prefers-reduced-motion`). This animation is the GIF.

### 5.13 Local server & security

- Bind **127.0.0.1 only**, random free port.
- `/api/source?file=…` resolves via `realpath` and must be under the repo root realpath → else 403. No directory listing. Deny dotfiles outside repo (`.env` inside repo is user's own choice — still their machine, their code).
- No network calls except explicit `--ai` provider. State it in README (privacy is a P4 selling point).

---

## 6. Testing strategy

1. **Real-trace corpus (`fixtures/traces/`)** — *collect before coding, Phase 0.* Target ≥30: Python — Django, Flask, FastAPI/uvicorn, pytest, celery, sqlalchemy, requests, asyncio chained, 3.11 anchor-decorated, ExceptionGroup, SyntaxError, JSON-wrapped k8s log; JS/TS — Express, Next.js (server + build), NestJS, plain node ESM/CJS, jest/vitest, async/await stacks, minified+sourcemap pair, pm2/winston-prefixed. Sources: own work/repos, public GitHub issues, Sentry docs examples. Each fixture = `NN-name.txt` + `NN-name.golden.json` (expected `ParsedTrace`).
2. **Unit:** extract (dirty-input cases §5.1), each parser bullet (§5.2), suffix path-matcher, symbol resolver, ghost detection, sourcemap rewrite. Golden-file pattern; `vitest --update` to regenerate.
3. **E2E:** `fixtures/repos/` mini-apps with deliberate bugs (double as `demo/`). Script runs the app, captures the real trace, pipes to `tracemap --json`, asserts graph invariants (crash node id, spine length, ≥1 ghost edge in the FastAPI demo via a decorated route).
4. **UI smoke (Playwright):** demo renders, spine visible, click node → source panel shows highlighted line, export HTML self-contains.
5. **Metrics harness:** `npm run corpus` prints parse-rate and resolution-rate tables — the numbers for §1.3 gates and the launch post.

---

## 7. Phased milestones (6 weekends, hard gates)

### Phase 0 — Validation spike (weekend 1) ⛔ GATE
Build throwaway scripts only. Collect the corpus (≥25 traces min). Then:
- [ ] Frame-level parse ≥90% of corpus → **if <75%, stop; redesign parsers before anything else.**
- [ ] Tree-sitter symbol resolution ≥80% of in-repo frames on 3 real repos (one of Han Qing's own + 2 OSS apps) → **if <60%, rescope nodes to file-level (still shippable, lesser product) and get human sign-off.**
- [ ] Static HTML mock of spine layout with 12 frames + 20 radius nodes is legible and screenshot-worthy.
**Deliverable:** `docs/phase0-report.md` with the two rates + screenshots. Human reviews before Phase 1.

### Phase 1 — Python end-to-end (weekends 2–3)
CLI (paste + stdin + `-t`), extract, Python parser, lazy analyze, resolve, graph build, server, UI spine + code panel + legend, `demo python`. **Accept:** FastAPI demo renders in <5s; corpus Python parse ≥90%; CI green on 3 OS.

### Phase 2 — JS/TS + hardening (weekend 4)
V8 parser, sourcemaps, dirty-log extraction complete, trace picker, tsconfig paths best-effort. **Accept:** `demo node` incl. a sourcemapped frame; JS corpus ≥90%.

### Phase 3 — The differentiators (weekend 5)
Ghost edges + filter, chained exceptions, blast radius + caller search, `--ref`, exports (HTML/SVG/PNG), badges, dark-theme polish, entry animation. **Accept:** demo shows ≥1 labeled ghost edge; exported HTML opens standalone; the 15-second GIF is recordable.

### Phase 4 — AI + MCP + docs (weekend 6)
AI providers + panel, MCP server (2 tools), README, adding-a-language.md, architecture.md. **Accept:** Ollama path works with a small local model; `claude mcp add` flow verified. **Feature freeze.**

### Launch weekend (separate; not counted in build timebox)
Execute §8 checklist only. No code beyond critical bugfixes.

If total spend threatens to exceed 6 weekends: cut Phase 4 AI (keep MCP), cut PNG export, cut ExceptionGroup — in that order. Never cut tests or the demo.

---

## 8. Launch plan

**Pre-launch:** name check (npm, GitHub, no trademark collision — §10); README = GIF (≤15s, dark, paste→render→click-to-source→ghost edge) above the fold, 3-command quickstart, condensed §2 table as "Why another code visualizer?", honest limitations section (name-based static edges, 2 languages, post-mortem only); MIT license; CONTRIBUTING with the frame-parser plugin guide; 5–8 `good-first-issue`s pre-filed (Go parser, Firefox trace format, Ruby, light theme…).

**Launch sequence (staggered, not same-day):**
1. **Show HN** — Tue–Thu, 8–10 am PT (= 11 pm–1 am SGT; schedule accordingly). Title: `Show HN: See your stack trace as a path through your codebase`. First comment pre-written: how it works (tree-sitter, lazy parsing, ghost edges), why local-only, honest limits.
2. Technical write-up (dev.to + repo `docs/`): "Resolving stack frames to symbols with tree-sitter" — internals posts outperform product posts on HN; submit it separately a week later.
3. Reddit: r/Python, r/node, r/typescript, r/programming — tailored demo per sub, days apart.
4. Newsletters: Python Weekly, JavaScript Weekly, Node Weekly, Console.dev, TLDR.
5. Directories: awesome-nodejs, awesome-python, awesome-developer-tools, awesome-mcp-servers, MCP registries.
6. X/LinkedIn thread with the GIF.

**Post-launch (2 weekends budgeted):** answer every issue <24h for the first two weeks (star-momentum is retention-of-attention); merge the first community language parser fast and celebrate it — that's the flywheel.

## 9. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Trace format variance breaks parsing in the wild | High | Corpus-first development (§6); exit-2 message asks users to file the trace as an issue (anonymized) — turns failures into fixtures. |
| Symbol resolution too imprecise | Medium | Phase 0 gate with numeric bar + file-level fallback plan; ghost edges make imprecision *visible and honest* rather than silently wrong. |
| Layout looks cramped on deep traces (30+ frames) | Medium | External-chip collapsing removes most depth; horizontal scroll + minimap if needed; cap + "+N" expanders. |
| WASM grammar bundle size / load time | Low | Lazy-load per language; measure; acceptable to 12 MB package. |
| Name collision / npm squat | Medium | Resolve in §10 before scaffolding. |
| Scope creep (more languages, live mode, VS Code ext) | High | §1.2 non-goals are contractual; plugin interface is the pressure-release valve. |
| Timebox overrun eating interview prep | High | Cut order defined in §7; 6-weekend hard cap; launch can slip, prep hours cannot. |

## 10. Housekeeping

- [x] Verify `tracemap` on npm + GitHub; if taken, evaluate `crashpath` / `stackscope` / `faultline` (avoid `traceview` — Android tool; `tracepath` — Linux util). Grab the name + GitHub org same day. **→ DECIDED: `crashpath`** (tracemap npm was free but GitHub org squatted; crashpath free on both). npm publish + GitHub org grab still pending (needs owner credentials).
- [ ] `LICENSE` MIT · `SECURITY.md` (localhost-only posture) · issue templates (bug template asks for the raw trace!).
- [ ] Conventional commits; release-please or changesets for versioning; `npm publish --provenance`.
- [ ] Add repo-specific `CLAUDE.md` derived from the existing solo-agentic guardrails: pnpm, biome, vitest, "never touch fixtures/golden files without human approval", "UI changes require screenshot in PR description".

---

## Appendix A — AI output schema (strict JSON)

```json
{
  "root_cause_hypothesis": "string, 2-4 sentences, must reference specific frames by index",
  "confidence": "low | medium | high",
  "per_frame_notes": [{ "frameIndex": 0, "note": "string, <=140 chars" }],
  "ghost_edge_explanations": [{ "edgeId": "string", "mechanism": "string", "explanation": "string" }],
  "suggested_fix": { "file": "string", "description": "string", "diff": "string (unified, optional)" } 
}
```
Validate with zod; on invalid JSON retry once with a repair prompt; then degrade to toast. System prompt must state: *you annotate an existing graph; you cannot add nodes or edges; cite frame indices; say "insufficient information" rather than guess.*

## Appendix B — Corpus collection checklist (do this first, Phase 0 day 1)

Own repos & past incidents (LLM routing proxy, Fiverr projects, Equinix-adjacent side scripts — sanitize paths) · trigger real failures in fixtures/repos apps · public GitHub issues with pasted tracebacks (Django, FastAPI, Next.js, NestJS trackers) · framework docs error examples · one k8s/pm2/winston-wrapped sample each · one minified React prod stack + its sourcemap. Sanitize: replace usernames/hosts, keep structure byte-accurate otherwise. Minimum 25 to start Phase 0, grow to 30+ by launch.

---

## Appendix C — Decision log (context from ideation, July 2026)

Recorded so this document stands alone. Claude Code: treat these as settled — do not relitigate during the build.

| # | Decision | Rationale / evidence |
|---|---|---|
| D1 | **Rejected:** standalone codebase-visualizer product (original idea 1). | Category is commercially dead (Sourcetrail discontinued 2021, CodeSee sunset post-acquisition 2024) yet saturated in OSS/free form: DeepWiki (free, Cognition), CodeViz (funded), deepwiki-open, GitDiagram, Understand-Anything, codegraph. Value of code graphs has shifted to agent context (MCP), not human-facing pictures. |
| D2 | **Rejected:** standalone "paste logs → AI-generated debugging dashboard" SaaS (original idea 2). | Three kill factors: (a) required widgets (memory timelines, network waterfalls) need telemetry that isn't present in a pasted trace/log; (b) chat + artifacts (Claude/ChatGPT) already deliver ~80% of this free — Sherlocking exposure; (c) observability incumbents generate dashboards where the data lives (Grafana Assistant, Sentry Seer, etc.) and prod-log paste is a compliance non-starter. |
| D3 | **Goal reframed: open source, not revenue.** Success = GitHub stars + portfolio signal for Google reapplication (~12-month horizon). Bar: **1,000 stars = success.** | Removing monetization removed the top kill factors. Star appetite in this category is proven: deepwiki-open >12.8k stars; "Sourcetrail alternative" still heavily searched years after EOL. Portfolio value: parsing, graph algorithms, systems design — interview-relevant material. |
| D4 | **Chosen concept: fuse both ideas** — post-mortem stack trace rendered as a path through the codebase graph. | Novelty verified by search: only live-debugger equivalents exist (Visual Studio Enterprise Code Map; CBRV VS Code extension) — both require an attached session. The post-mortem case (CI/prod traces, no live process) is unserved. The trace also solves the hairball problem that kills all code visualizers: it is a principled filter selecting the ~10 relevant nodes. |
| D5 | **Differentiators locked from documented competitor pain** (full mapping in §2). | Trace-as-filter lazy parsing (vs. deepwiki-open large-repo failures); visual epistemology separating runtime/static/AI (vs. LLM-guessed diagrams); custom SVG renderer, no Mermaid anywhere; ghost edges as flagship (runtime truth vs. static blindness); `--ref` for prod line-number drift; `npx` zero-setup, local-only, no key. |
| D6 | **Scope: Python + TypeScript/JavaScript only in v1**, via tree-sitter WASM; community plugin interface for further languages. | Sourcetrail died on the per-language native-indexer maintenance treadmill. WASM grammars + ~200-line frame parsers cost ~1% of that. Py/TS are the maintainer's stack and the loudest launch communities. |
| D7 | **AI strictly optional** (BYO key: Anthropic/OpenAI/Ollama); annotation only, never graph structure. **MCP server included** as a second distribution channel. | Zero-key requirement protects the 60-second demo and the privacy positioning; small payloads (~3–5k tokens) make local Ollama viable. MCP directories/awesome-lists are proven OSS distribution. |
| D8 | **Constraints:** 6-weekend build cap + separate launch weekend; Phase 0 numeric gates (parse ≥90%, resolution ≥80%; kill/rescope at 75%/60%); cut order AI → PNG export → ExceptionGroup; interview-prep hours are protected and outrank launch timing. | Solo-dev governance per existing CLAUDE.md practice; the project complements, not replaces, the 12-month Google prep roadmap. |
| D9 | **Working name `tracemap`** pending npm/GitHub availability (alternates: `crashpath`, `stackscope`, `faultline`; avoid `traceview`/`tracepath` — existing tools). | First housekeeping action, §10. |
