// Direct-fetch provider clients (§3.4) — no heavy SDKs. Keys come from the
// environment; `fetchImpl` is injectable for tests.
export type AiProvider = "anthropic" | "openai" | "ollama";

export interface AiConfig {
  provider: AiProvider;
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
  ollama: "llama3.2",
};

const MAX_TOKENS = 1500;

export async function complete(config: AiConfig, system: string, user: string): Promise<string> {
  const doFetch = config.fetchImpl ?? fetch;
  const model = config.model ?? DEFAULT_MODELS[config.provider];

  if (config.provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    const res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic: HTTP ${res.status} ${await safeText(res)}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("anthropic: empty response");
    return text;
  }

  if (config.provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const res = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai: HTTP ${res.status} ${await safeText(res)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("openai: empty response");
    return text;
  }

  // ollama — local, no key; `format: "json"` forces valid JSON from the model
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const res = await doFetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      // thinking-mode models (qwen3 etc.) otherwise spend the whole token
      // budget reasoning before emitting JSON
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama: HTTP ${res.status} ${await safeText(res)}`);
  const body = (await res.json()) as { message?: { content?: string } };
  const text = body.message?.content;
  if (!text) throw new Error("ollama: empty response");
  return text;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
