import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src/server/index.js";

const DEMO = fileURLToPath(new URL("../demo/python", import.meta.url));
const TRACE = fs.readFileSync(path.join(DEMO, "trace.txt"), "utf8");

const ANNOTATION = {
  root_cause_hypothesis: "Frame 40 fails on a trailing-space currency key.",
  confidence: "medium",
  per_frame_notes: [],
  ghost_edge_explanations: [],
};

const realFetch = globalThis.fetch;

/** fake ONLY the ollama endpoint; everything else (our own server) stays real */
function stubOllama(responder: () => Response) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes("/api/chat")) return responder();
    return realFetch(url as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
  }) as typeof fetch;
}

let server: RunningServer;

beforeAll(async () => {
  server = await startServer({
    repoRoot: DEMO,
    port: 0,
    ai: { provider: "ollama", model: "test-model" },
  });
  await realFetch(`${server.url}/api/trace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: TRACE }),
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await server.close();
});

describe("AI over the server (§3.4)", () => {
  it("exposes the configured provider via /api/config", async () => {
    const res = await realFetch(`${server.url}/api/config`);
    const body = (await res.json()) as { ai: { provider: string } | null };
    expect(body.ai?.provider).toBe("ollama");
  });

  it("annotates the current graph", async () => {
    stubOllama(
      () =>
        new Response(JSON.stringify({ message: { content: JSON.stringify(ANNOTATION) } }), {
          status: 200,
        }),
    );
    const res = await realFetch(`${server.url}/api/ai`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof ANNOTATION;
    expect(body.root_cause_hypothesis).toContain("trailing-space");
  });

  it("degrades provider failures to a 502 with a message", async () => {
    stubOllama(() => new Response("boom", { status: 500 }));
    const res = await realFetch(`${server.url}/api/ai`, { method: "POST" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("ollama");
  });

  it("501s when AI is not configured", async () => {
    const bare = await startServer({ repoRoot: DEMO, port: 0 });
    try {
      const res = await realFetch(`${bare.url}/api/ai`, { method: "POST" });
      expect(res.status).toBe(501);
    } finally {
      await bare.close();
    }
  });
});
