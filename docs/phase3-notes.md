# Phase 3 notes — the differentiators

**Date:** 2026-07-11 · **§7 acceptance: all bars met.**

| Acceptance (§7 Phase 3) | Result |
|---|---|
| Demo shows ≥1 labeled ghost edge | ✅ `build_quote → price_with_tax`, labeled `decorator-dispatched (@pricer)` — asserted in unit tests AND e2e |
| Exported HTML opens standalone | ✅ e2e opens the export from `file://`, clicks the crash node, sees the source snippet — zero external requests |
| 15-second GIF recordable | ✅ storyboard below; the flagship frame: |

![flagship](assets/phase3-ui-flagship.png)

## What shipped

- **Ghost edges (§5.7, the flagship)** — consecutive resolved function nodes on the spine with no static call edge get a violet dashed arc + ⚡ + a hint: `decorator-dispatched (@…)` (callee has decorators) → `through framework/library` (hop crosses a chip) → `dynamic dispatch`. Module-level/unresolved pairs are honestly skipped. The demo was reworked to a decorator registry (`PRICERS[kind]` dispatch) so the flagship moment is real, not staged. "Ghost edges only" toolbar filter dims everything else.
- **Blast radius (§5.8)** — callees from 1-level import analysis; callers via `git grep -lwF` (bounded fs-scan fallback), stoplist + min-length guards, unique-resolution only, degree-capped at 60. Radius nodes join the graph *before* the §5.6 edge pass, which wires the links with the same rules as everything else. UI: callers above / callees below, `+N more` overflow, default-ON toggle (auto-off >120 nodes).
- **Chained exceptions (§5.11)** — stacked spine rows, newest on top, `↳ caused by` / `↳ during handling of` connectors. Layout moved to `src/graph/layout.ts` — one pure function shared by UI and exporters.
- **`--ref` (§5.10)** — detached git worktree of the crashed version; cleanup on completion/SIGINT + 24h GC of stale worktrees; `@ <ref>` badge in the header. The gitref test proves the point: v1-recorded trace resolves cleanly under `--ref v1` but shows `line-name-mismatch` drift badges against HEAD.
- **Exports (Flow D)** — `crashpath export -t trace.txt -o failure.html|svg`. HTML embeds per-node source snippets read at export time + ~40 lines of vanilla JS; SVG is the same shared layout, styled inline. No React, no fonts, no network.

## GIF storyboard (launch asset, §8)

1. `npx crashpath demo` → terminal → browser opens (0–3s)
2. Trace path draws left→right, crash node pulses (3–6s)
3. Click crash node → source panel, KeyError line highlighted (6–9s)
4. Toggle "⚡ Ghost edges only" → the decorator dispatch pops (9–13s)
5. End card on the ghost label (13–15s)

## Cut per §7 cut order

- PNG toolbar export (client-side canvas) — HTML/SVG exports cover the share story; PNG can return post-launch.

## Test totals

111 vitest + 3 Playwright e2e; corpus 32/32 unchanged; lint/typecheck/build clean.
