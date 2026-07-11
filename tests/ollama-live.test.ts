// §7 Phase 4 acceptance: "Ollama path works with a small local model."
// This test talks to a REAL local Ollama daemon; it is skipped when the
// daemon isn't reachable (CI has none — run locally to verify acceptance).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotate } from "../src/ai/index.js";
import { runPipeline } from "../src/pipeline.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));
const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
// smallest-first is the acceptance spirit, but tiny models are JSON-flaky;
// prefer the most reliable small model that is actually installed
const PREFERRED = process.env.CRASHPATH_OLLAMA_TEST_MODEL
  ? [process.env.CRASHPATH_OLLAMA_TEST_MODEL]
  : ["qwen3:4b", "qwen3:1.7b", "llama3.2"];

async function pickModel(): Promise<string | null> {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name: string }[] };
    const installed = new Set((body.models ?? []).map((m) => m.name));
    return PREFERRED.find((m) => installed.has(m)) ?? null;
  } catch {
    return null;
  }
}

const MODEL = await pickModel();
const available = MODEL !== null;

describe.skipIf(!available)("Ollama live (§7 Phase 4 acceptance)", () => {
  it(`annotates the demo crash with ${MODEL}, schema-valid`, async () => {
    const text = fs.readFileSync(`${DEMO}/trace.txt`, "utf8");
    const pipelineResult = await runPipeline(text, DEMO);
    if (!pipelineResult.ok) throw new Error(pipelineResult.message);

    const result = await annotate(pipelineResult.graph, DEMO, {
      provider: "ollama",
      model: MODEL as string,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.annotation.root_cause_hypothesis.length).toBeGreaterThan(20);
      expect(["low", "medium", "high"]).toContain(result.annotation.confidence);
    }
  }, 120_000);
});

describe.skipIf(available)("Ollama live (skipped)", () => {
  it("daemon not reachable — run locally with ollama + qwen3:1.7b to verify acceptance", () => {
    expect(true).toBe(true);
  });
});
