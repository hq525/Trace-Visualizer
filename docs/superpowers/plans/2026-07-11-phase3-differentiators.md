# Phase 3: Differentiators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghost edges (flagship), blast radius with caller search, chained-exception stacked spines, `--ref`, HTML/SVG exports, GIF-grade polish. §7 acceptance: demo shows ≥1 labeled ghost edge; exported HTML opens standalone; the 15s GIF is recordable.

**Architecture:** Ghost detection and blast radius extend the graph stage (radius is a new pipeline stage — it touches fs/git, the builder stays pure). `--ref` wraps the pipeline in a git-worktree lifecycle. Exports render the same pure layout server-side (layout moves from ui/ to src/graph/ so both sides share it). Conventions per Phases 1–2.

## Global Constraints

- All Phase 1/2 constraints hold (frozen goldens — the demo trace is NOT a golden and may be re-recorded; corpus stays 32/32; caps §5.4/§5.8; no new deps).
- Ghost edges: §5.7 verbatim — runtime evidence, emitted only between resolved FUNCTION nodes (module-level/unresolved pairs are skipped: we cannot assess static edges there honestly).
- Caller search: `git grep -nwF`, fallback bounded fs scan; skip symbols <4 chars or on the stoplist (§5.8); radius cap 60 nodes by degree, per-anchor visual cap with "+N more".
- Cut order if time threatens (§7): PNG toolbar export is already sanctioned to cut — HTML/SVG exports stay.

## Tasks

### Task 1: Ghost edges + demo rework (flagship, acceptance bar 1)
- Rework `demo/python/services.py` to a decorator registry: `@pricer("physical") def price_with_tax…`, dispatched via `PRICERS[product["kind"]](product, currency)`; `store.py` products gain `"kind"`. Re-record `trace.txt` (same crash, same sanitization).
- `src/graph/build.ts`: after static edges, walk adjacent in-repo FUNCTION nodes along the spine; no `call` edge a→b → emit `{kind:"ghost", evidence:"runtime", ghostHint}`. Hint priority (§5.7): callee decorators (from the file analysis) → `decorator-dispatched (@pricer)`; chip between a,b on the spine → `through framework/library`; else `dynamic dispatch`.
- UI: dashed violet ghost path arcing above the spine + ⚡ + hint label (port from the mock); "Ghost edges only" toolbar toggle becomes functional (dims non-ghost edges/nodes).
- Tests: graph test asserts exactly the build_quote→price_with_tax ghost with the decorator hint and that statically-linked pairs get none; demo test asserts ≥1 ghost edge (the acceptance bar, machine-checked).

### Task 2: Blast radius + caller search (§5.8)
- `src/graph/radius.ts`: `collectRadius(resolved, index, analyses)` → `{ callees, callers }`.
  Callees: unique-resolved call targets of spine functions that aren't on the spine (reuses the §5.6 matcher). Callers: `git -C root grep -nwF <symbol>` (fallback: scan indexed files) → candidate files → analyze within caps → keep calls uniquely resolving to the spine symbol → enclosing caller functions. Stoplist `get run main init handler process update create delete`, min length 4.
- `buildGraph(…, radius)`: radius nodes `onSpine:false` + static call edges to/from spine anchors; cap 60 by degree.
- Layout: callers stack above their anchor column, callees below, nearest-first, ≤2 rows per direction then a `+N more` pseudo-node. UI: 40% opacity, blast-radius toggle (default ON, auto-OFF >120 rendered nodes §3.3).
- Tests: temp repo where a spine function has one static callee off-spine and one caller found via git grep; assert radius nodes + edges + caps; layout test for above/below placement.

### Task 3: Chained exceptions UI (§5.11)
- Move `layoutGraph` to `src/graph/layout.ts` (shared; ui imports it — exports need it server-side too). Extend: `graph.chained[]` renders as additional spine rows below, newest (top-level) first, 1.5× row gap, connector label "caused by" / "during handling of".
- UI renders all rows + connectors; keyboard nav walks the top spine only (v1).
- Tests: buildGraph directly on parsed fixture 03 (cause chain) → layout has two rows, connector labeled "caused by", second row y > first row y.

### Task 4: `--ref` (§5.10)
- `src/gitref/index.ts`: `withRef(repoRoot, ref, fn)` — `git worktree add --detach <tmp>/crashpath-ref-<rand> <ref>` → run fn(worktreePath) → `git worktree remove --force` in finally + SIGINT; startup GC of `crashpath-ref-*` older than 24h. Not a git repo / bad ref → clear error (exit 1).
- CLI `--ref <ref>`: `--json` runs inside withRef; server mode keeps the worktree until exit (cleanup registered on close/SIGINT). `meta.ref` set; UI header shows the `@ <ref>` badge (from the mock).
- Tests: build a scratch git repo with v1 tag (function at old line numbers) then HEAD moves it; trace with v1 lines → without --ref: `line-name-mismatch` badge; with --ref v1: clean resolution and `meta.ref === "v1"`; worktree dir removed afterwards.

### Task 5: Exports (Flow D, acceptance bar 2)
- `src/export/index.ts`: `renderSvg(graph)` — static SVG mirroring GraphView (spine, chips, radius, ghost arcs, legend, header). `renderHtml(graph, snippets)` — single self-contained file: the SVG + dark CSS inline + per-node source snippets (read at export time, ±10 lines) + minimal vanilla JS for click-to-snippet. No external requests, no React.
- CLI: `crashpath export -t <file> -o out.html|out.svg [-r repo] [--ref]` — format from extension; same exit codes.
- Tests: unit (svg contains node names + ghost dash markup; html contains no `http`/`src=` external refs); e2e: export demo python → `page.goto(file://…)` → nodes visible, click shows snippet.

### Task 6: Polish + report + PR
- Entry animation already ships; verify radius/ghost stagger reads well; screenshot demo python (ghost + radius) + exported HTML for docs/assets; docs/phase3-notes.md (acceptance table, GIF storyboard notes); full CI sequence; push + PR.

## Self-Review
- §7 Phase 3 list: ghost edges + filter T1 ✓ · chained T3 ✓ · blast radius + caller search T2 ✓ · --ref T4 ✓ · exports T5 ✓ (PNG toolbar deliberately cut per §7 cut order) · badges/dark polish/animation T6 ✓.
- Acceptance mapping: ≥1 labeled ghost edge in demo → T1 test; exported HTML standalone → T5 e2e; GIF recordable → T6 screenshots as proxy.
- Type consistency: ghost edges use existing GraphEdge.ghostHint (§5.9); radius nodes reuse GraphNode with onSpine:false; layout move keeps one source of truth.
