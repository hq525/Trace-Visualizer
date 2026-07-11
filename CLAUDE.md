# crashpath — repo guardrails

plan.md is the single source of truth. Appendix C decisions are settled — do not relitigate.
Phase gates (§7) require explicit human sign-off before moving to the next phase.

## Hard rules

- **Never modify `fixtures/traces/**` (traces or goldens) without explicit human approval.**
  Goldens are runtime-derived or hand-audited; regenerating them silently destroys the
  corpus's evidentiary value. New fixtures are welcome; edits to existing ones are not.
- No new runtime dependencies without discussion (current allowance: hono,
  @hono/node-server, web-tree-sitter 0.20.8 — pinned to match the grammar wasm ABI).
- No Mermaid, no DB, no telemetry, no network calls beyond an explicit future `--ai`.
- Server binds 127.0.0.1 only; `/api/source` stays realpath-sandboxed to the repo root.
- UI changes require a screenshot in the PR description / phase report.
- AI never draws graph structure (§5.9: AI output has no node/edge fields).

## Toolchain

- `npm test` — vitest; `npm run corpus` — the parse-rate gate table
- `npm run lint` — biome; `npm run typecheck` — tsc over src + tests
- `npm run build` — tsc + ui build into dist/; `npx playwright test` — e2e smoke
- Conventional commits; commit per task; keep the corpus green at every commit

## Definition of done (any parser/resolver change)

Corpus stays ≥ 31/32 trace-level; resolution stays 100% on the demo; all tests green
on the 3-OS CI matrix.
