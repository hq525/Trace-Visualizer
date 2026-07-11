# Launch sequence (§8) — staggered, never same-day

| Day | Channel | Angle |
|---|---|---|
| D0 (Tue–Thu, 8–10am PT) | Show HN | see show-hn.md |
| D+2 | r/Python | "Paste a Python traceback, see it as a path through your code" — lead with the FastAPI/decorator ghost-edge demo GIF |
| D+4 | r/node, r/typescript | lead with the minified-stack story: `dist/bundle.js:1:4823` → `src/pricing.ts:19` via sourcemaps |
| D+6 | r/programming | the epistemology angle: "runtime fact vs parsed evidence vs AI inference should never look the same" |
| week 1 | Newsletters | Python Weekly, JavaScript Weekly, Node Weekly, Console.dev, TLDR — 2-sentence blurb + GIF |
| week 1 | Directories | awesome-nodejs, awesome-python, awesome-developer-tools, awesome-mcp-servers, MCP registries (`crashpath mcp`) |
| week 2 | dev.to + docs/ | internals post: "Resolving stack frames to symbols with tree-sitter" → submit to HN separately |
| ongoing | X/LinkedIn | thread with the GIF, one design decision per post |

## Newsletter blurb (copy-paste)

> **crashpath** — paste a raw stack trace (even buried in k8s/JSON logs) and see the failure as
> an interactive path through your codebase graph. tree-sitter-parsed, local-only, zero setup:
> `npx crashpath demo`. Its flagship trick: "ghost edges" that make dynamic dispatch —
> decorators, registries, framework magic — visible where static analysis is blind.

## Post-launch commitments (2 weekends budgeted)

- Answer every issue <24h for the first two weeks.
- First community language parser: fast-track review, then celebrate it loudly (release notes,
  thread, README credit) — that's the flywheel.
- Traces that fail to parse → corpus fixtures, credited to the reporter.
