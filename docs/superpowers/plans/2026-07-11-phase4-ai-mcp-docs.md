# Phase 4: AI + MCP + docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional AI annotation (Anthropic/OpenAI/Ollama, Appendix A schema, never graph structure), `crashpath mcp` stdio server (2 tools), launch docs (README, architecture, adding-a-language). §7 acceptance: Ollama path works with a small local model; MCP flow verified. Then **feature freeze**.

**Architecture:** AI is a strictly additive layer: server-side `POST /api/ai` annotates the CURRENT graph and returns Appendix-A JSON (zod-validated; the schema has no node/edge fields — G3 enforced by type). Providers are direct `fetch` calls with an injectable fetch for tests. MCP reuses the pipeline + server modules. Conventions per Phases 1–3.

## Global Constraints

- All prior constraints; **new deps sanctioned by plan.md**: `zod` (Appendix A) and `@modelcontextprotocol/sdk` (§3.5). No heavy AI SDKs — direct fetch (§3.4).
- AI failure degrades to a dismissible toast; core UI unaffected. System prompt states: annotate only, cite frame indices, "insufficient information" over guessing.
- Payload budget ≈3–5k tokens: spine frames + ±5-line snippets, ghost edges, radius names.
- Keys via `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OLLAMA_HOST`; `--ai <provider>` + `--model <name>`.
- Feature freeze at the end of this phase — anything not in §7 Phase 4 is out.

## Tasks

### Task 1: AI core (`src/ai/`)
- `schema.ts`: zod schema of Appendix A verbatim (`root_cause_hypothesis`, `confidence`, `per_frame_notes[]`, `ghost_edge_explanations[]`, `suggested_fix?`) + inferred type.
- `payload.ts`: `buildPrompt(graph, repoRoot)` → `{system, user}`; snippets read at call time; ghost edge ids + hints; radius symbol list; Appendix-A system prompt.
- `providers.ts`: `complete(config, system, user)` for anthropic (`/v1/messages`), openai (`/v1/chat/completions`), ollama (`/api/chat`, `format:"json"`, host from `OLLAMA_HOST` else 127.0.0.1:11434). `config.fetchImpl` injectable.
- `index.ts`: `annotate(graph, repoRoot, config)` — parse (strip code fences) → zod validate → one repair-prompt retry → typed ok/error.
- Tests: schema accept/reject; payload contains crash snippet + ghost id and matches the token budget order of magnitude; each provider called with right URL/headers/body via fake fetch; repair-retry path.

### Task 2: server + CLI + UI panel
- Server options `ai?: {provider, model?}`; `GET /api/config` → `{ai}`; `POST /api/ai` → annotate current graph (404 no graph, 501 not configured, 502 provider failure with message).
- CLI `--ai <anthropic|openai|ollama>` + `--model`; passes to server.
- UI: "✨ AI inference" section in the side panel (only when configured): Analyze/Regenerate button, root-cause + confidence, suggested fix (+diff `<pre>`), ghost explanations, per-frame note for the selected node. Clearly badged as inference; failures → toast.
- Tests: server route with `globalThis.fetch` stubbed in-test (no prod seams): ok, invalid-JSON→repair, provider 500→502.

### Task 3: MCP server (§3.5)
- `src/mcp/index.ts` with `@modelcontextprotocol/sdk`: stdio transport; tools `map_trace(trace_text, repo_path?, ref?)` → starts/reuses the local HTTP server, returns `{url, exception, crash{file,line,symbol}, frames_resolved, frames_total, ghost_edges[], radius_summary}`; `export_trace_map(trace_text, format, repo_path?)` → `{file_path}` (tmp dir). CLI subcommand `mcp`.
- Test: SDK Client over StdioClientTransport spawning the built CLI; `tools/list` shows both; `map_trace` on the python demo returns KeyError + fx.py crash + ≥1 ghost edge + live URL; `export_trace_map` writes a real HTML file.

### Task 4: Ollama live verification + docs
- `tests/ollama-live.test.ts`: skipped unless `http://127.0.0.1:11434` responds; real `annotate()` with `qwen3:1.7b` on the demo graph; asserts schema-valid output (§7 acceptance, runs locally; CI skips).
- `README.md`: hero (GIF placeholder for launch weekend), 3-command quickstart, condensed §2 "Why another code visualizer?" table, epistemology legend, honest limitations, MCP + AI setup incl. `claude mcp add crashpath -- npx crashpath mcp`, MIT.
- `LICENSE` (MIT), `docs/architecture.md` (pipeline + stage contracts + invariants), `docs/adding-a-language.md` (FrameParser + analyzer walk-through with real interfaces).
- `SECURITY.md` (localhost-only posture, §10).

### Task 5: freeze — verify, screenshots, notes, PR
- Full CI sequence + e2e; AI-panel screenshot (fake/ollama); docs/phase4-notes.md (acceptance evidence incl. the live Ollama transcript); push, PR, CI watch. Declare feature freeze in the notes.

## Self-Review
- §7 Phase 4 list covered: AI providers+panel T1/T2, MCP T3, README/adding-a-language/architecture T4, Ollama acceptance T4, freeze T5. `claude mcp add` flow: the stdio server is verified with the official SDK client (equivalent transport-level proof); the exact command is documented in README.
- G3 invariant: Appendix A schema has no node/edge fields; server never merges AI output into the graph.
