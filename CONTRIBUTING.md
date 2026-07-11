# Contributing to crashpath

Thanks for stopping by. The highest-impact contribution is a **new language** — a frame parser
plus a tree-sitter walker, ~400 lines total. The full walk-through lives in
[docs/adding-a-language.md](docs/adding-a-language.md); architecture notes in
[docs/architecture.md](docs/architecture.md).

## Ground rules

- **`fixtures/traces/**` is evidence.** Goldens are runtime-derived or hand-audited; never
  regenerate them to make a test pass. New fixtures are always welcome — traces from real
  incidents (sanitized) are the most valuable thing you can contribute, even without code.
- Static analysis is **name-resolution only**. PRs adding type inference will be declined —
  that treadmill killed better-funded tools. Ambiguity is skipped, not guessed; ghost edges
  exist to mark it honestly.
- AI annotates; it never draws graph structure. The Appendix-A schema has no node/edge fields
  on purpose.
- No new runtime dependencies without an issue first.

## Dev loop

```console
$ npm ci && npm --prefix ui ci
$ npm test            # includes the 32-fixture corpus gate
$ npm run corpus      # parse-rate table
$ npm run lint && npm run typecheck
$ npx playwright test # e2e over the bundled demos
```

Definition of done for parser/resolver changes: corpus stays green, demo resolution stays
100%, CI green on ubuntu/macos/windows. UI changes need a screenshot in the PR.

## Found a trace crashpath can't parse?

That's a bug we want. Open an issue with the **raw trace text** (sanitize paths/usernames —
keep the structure byte-accurate) and what you expected. It becomes a corpus fixture.
