# Show HN launch kit

**When:** Tue–Thu, 8–10 am PT (= 11 pm–1 am SGT). Don't launch same-day with other channels.

## Title

> Show HN: See your stack trace as a path through your codebase

(≤80 chars; no exclamation marks; the URL is the GitHub repo.)

## First comment (post immediately after submitting)

---

Hi HN — I built crashpath because every time I stared at a traceback from CI or prod logs, I
was reconstructing the same picture in my head: which of these 40 frames are *my* code, how do
they connect, and what's around them. There's no live process to attach a debugger to in that
moment — the post-mortem case is weirdly unserved.

How it works: paste a raw trace (or pipe a log — it strips k8s/CI/framework prefixes and digs
traces out of JSON log lines). It parses ONLY the files the trace touches with tree-sitter
(WASM, no native builds), resolves frames to symbols by longest path-suffix + span lookup, and
renders the failure as a left-to-right spine with 1-hop callers/callees around it.

The part I care most about is what I call ghost edges: when the runtime hopped between two of
your functions but no static call edge exists between them, you get a dashed violet arc labeled
with the likely mechanism (decorator registry, framework dispatch, dynamic import). Static
analysis being blind to runtime dispatch is usually a tool's dirty secret — the trace lets you
make it visible instead.

Design choices that might interest folks here:

- Three evidence layers, visually distinct: the red path is runtime fact; grey edges are
  parsed, name-resolution-only static evidence (no type inference — on purpose; that
  maintenance treadmill is what killed Sourcetrail); AI comment­ary, if you opt in, is badged
  and can never draw nodes or edges — the output schema literally has no such fields.
- Local-first: binds 127.0.0.1, no telemetry, works offline. The optional AI runs fine on a
  local 3–4B model via Ollama because the payload is just ~3.5k tokens of frames + snippets.
- `--ref v1.4.2` checks out the version that actually crashed in a throwaway git worktree, so
  prod line numbers stop lying to you.
- The parser corpus is 32 real, ugly traces with goldens derived from the runtimes themselves
  (Python's TracebackException, V8's CallSite API) — not from my own regexes.

Python + JS/TS (incl. sourcemaps for minified stacks) in v1. Adding a language is a ~200-line
frame parser + a tree-sitter walker; guide is in the repo.

Honest limitations: name-based static edges (ambiguity is skipped, not guessed), post-mortem
only (no DAP), two languages so far.

`npx crashpath demo` shows everything in one command. I'd love to hear about traces it fails
on — those literally become test fixtures.

---

## Notes for the thread

- Lead with corpus numbers when asked about robustness (32/32 trace-level; goldens
  runtime-derived).
- If asked "why not just ask ChatGPT": that's the text-only failure mode — no spatial context,
  no ground truth, and you can't tell inferred edges from real ones. crashpath's whole point is
  separating fact/evidence/inference.
- If asked about Sourcetrail: died on native per-language indexers; tree-sitter WASM +
  ~200-line frame parsers is the 1% cost version of that idea.
- Week later: submit the internals write-up ("Resolving stack frames to symbols with
  tree-sitter") separately.
