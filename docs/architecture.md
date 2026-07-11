# crashpath architecture

## Pipeline

```
raw text ──▶ extract ──▶ parse frames ──▶ [sourcemap] ──▶ resolve to repo ──▶ lazy analyze ──▶ radius ──▶ build graph ──▶ serve/render
            (find trace   (per-language    (JS only,       (suffix path       (tree-sitter      (callers    (nodes, edges,    (hono on
             blocks in     regex parsers,   §5.3)           match + symbol     on touched        via git     ghost, radius,    127.0.0.1 +
             dirty logs)   normalize)                       lookup)            files only)       grep)       chips)            React SVG UI)
```

Every stage is a pure function with a serializable output; fs/git access is isolated to
explicit stages (resolve reads files, radius shells out to `git grep`, gitref manages
worktrees). That's what makes the 32-fixture golden corpus possible.

## Stage contracts (the actual types)

| Stage | Module | In → Out |
|---|---|---|
| extract | `src/extract` | dirty text → `ExtractedTrace[]` (handles JSON-wrapped logs, k8s/Azure/NestJS prefixes, pytest formats) |
| parse | `src/parsers/{python,v8}` | trace block → `ParsedTrace` (frames always root-call → crash; chained via `cause`/`context`) |
| sourcemap | `src/sourcemap` | mutates frames in generated files back to original sources (`mappedFrom`, `via-sourcemap` badge) |
| resolve | `src/resolve` | frame → repo file (longest path-suffix) → innermost tree-sitter symbol (+ drift/ambiguity badges) |
| analyze | `src/analyze/{python,javascript}` | file → `FileAnalysis` (symbols with spans + decorators, imports, name-level call sites) |
| radius | `src/graph/radius` | spine symbols → 1-hop caller/callee `RadiusCandidate[]` (§5.8 stoplist + caps) |
| build | `src/graph/build` | everything → `TraceGraph` (§5.9) — the `--json` output and the single contract for UI, exports, MCP |
| layout | `src/graph/layout` | `TraceGraph` → deterministic positions; shared by the React UI and the SVG/HTML exporters |

## Invariants (enforced, not aspirational)

1. **Frames are root-call → crash** everywhere; V8's crash-first order is normalized at parse time.
2. **Every edge carries evidence**: `runtime` (the trace) or `static` (tree-sitter). Ghost edges
   are runtime evidence of a hop static analysis couldn't see.
3. **Static call edges are unique-match only** (§5.6): a name that resolves to ≠1 candidate emits
   nothing. No type inference, ever.
4. **AI never draws structure**: the Appendix-A schema (`src/ai/schema.ts`) has no node/edge
   fields; annotations render in a badged panel only.
5. **Caps everywhere** (§5.4/§5.8): ≤150 analyzed files, ≤2 MB/file, ≤60 radius nodes by degree,
   bounded caller grep. No whole-repo pass exists in the codebase.
6. **fixtures/traces/ goldens are frozen** — runtime-derived or hand-audited evidence
   (see CLAUDE.md).

## Testing model

- **Corpus gate** (`npm run corpus`): 32 real-world fixtures, goldens derived from the runtime
  itself (Python `TracebackException`, V8 `CallSite`s) — parse changes are measured, not vibed.
- Unit tests per stage; e2e (Playwright) drives the demos and the standalone HTML export.
- `tests/ollama-live.test.ts` verifies the local-model AI path against a real Ollama daemon
  (skipped when absent, e.g. in CI).
