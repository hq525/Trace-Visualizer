import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { annotate } from "../src/ai/index.js";
import { buildPrompt } from "../src/ai/payload.js";
import { AiAnnotationSchema } from "../src/ai/schema.js";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));

const VALID_ANNOTATION = {
  root_cause_hypothesis:
    "Frame 40 raises KeyError because the currency string carries a trailing space (frames 37-40).",
  confidence: "high",
  per_frame_notes: [{ frameIndex: 40, note: "RATES lookup uses the raw query param" }],
  ghost_edge_explanations: [
    { edgeId: "ghost:0", mechanism: "registry", explanation: "PRICERS dict dispatch" },
  ],
  suggested_fix: {
    file: "fx.py",
    description: "strip() the currency code before lookup",
  },
};

let graph: TraceGraph;

beforeAll(async () => {
  const text = fs.readFileSync(`${DEMO}/trace.txt`, "utf8");
  const result = await runPipeline(text, DEMO);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
});

describe("AI schema (Appendix A)", () => {
  it("accepts a valid annotation and has no node/edge fields (G3 by construction)", () => {
    const parsed = AiAnnotationSchema.parse(VALID_ANNOTATION);
    expect(parsed.confidence).toBe("high");
    expect("nodes" in AiAnnotationSchema.shape).toBe(false);
    expect("edges" in AiAnnotationSchema.shape).toBe(false);
  });

  it("rejects malformed output", () => {
    expect(AiAnnotationSchema.safeParse({ confidence: "very" }).success).toBe(false);
  });
});

describe("AI payload (§3.4)", () => {
  it("includes crash snippet, ghost edge id + hint, and radius names, within budget", () => {
    const { system, user } = buildPrompt(graph, DEMO);
    expect(system).toContain("cannot add nodes or edges");
    expect(user).toContain("return RATES[currency]"); // crash snippet
    expect(user).toContain("ghost:0");
    expect(user).toContain("decorator-dispatched");
    expect(user).toContain("get_product"); // radius symbol
    // ≈3–5k tokens ≈ ≤20k chars for this small demo
    expect(user.length).toBeLessThan(20_000);
  });
});

describe("AI providers + orchestration", () => {
  const fetchReturning = (bodies: string[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    let i = 0;
    const impl = (async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      const body = bodies[Math.min(i++, bodies.length - 1)];
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    return { impl, calls };
  };

  it("calls ollama with format=json and parses the annotation", async () => {
    const { impl, calls } = fetchReturning([
      JSON.stringify({ message: { content: JSON.stringify(VALID_ANNOTATION) } }),
    ]);
    const result = await annotate(graph, DEMO, {
      provider: "ollama",
      model: "qwen3:1.7b",
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.annotation.confidence).toBe("high");
    expect(calls[0].url).toContain("127.0.0.1:11434/api/chat");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.format).toBe("json");
    expect(sent.model).toBe("qwen3:1.7b");
  });

  it("retries once with a repair prompt on invalid JSON, then succeeds", async () => {
    const { impl, calls } = fetchReturning([
      JSON.stringify({ message: { content: "definitely not json {" } }),
      JSON.stringify({
        message: { content: `\`\`\`json\n${JSON.stringify(VALID_ANNOTATION)}\n\`\`\`` },
      }),
    ]);
    const result = await annotate(graph, DEMO, { provider: "ollama", fetchImpl: impl });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(String(calls[1].init.body)).toContain("invalid");
  });

  it("degrades to a typed error after the retry also fails", async () => {
    const { impl } = fetchReturning([
      JSON.stringify({ message: { content: "nope" } }),
      JSON.stringify({ message: { content: "still nope" } }),
    ]);
    const result = await annotate(graph, DEMO, { provider: "ollama", fetchImpl: impl });
    expect(result.ok).toBe(false);
  });

  it("sends anthropic requests with api key header and version", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { impl, calls } = fetchReturning([
      JSON.stringify({ content: [{ type: "text", text: JSON.stringify(VALID_ANNOTATION) }] }),
    ]);
    const result = await annotate(graph, DEMO, { provider: "anthropic", fetchImpl: impl });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toContain("api.anthropic.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBeDefined();
  });
});
