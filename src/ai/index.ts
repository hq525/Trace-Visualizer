// AI orchestration (§3.4 / Appendix A): prompt → provider → strict-JSON
// validation, one repair retry, then a typed failure the UI turns into a
// dismissible toast. The annotation NEVER touches graph structure.
import type { TraceGraph } from "../graph/types.js";
import { buildPrompt } from "./payload.js";
import { type AiConfig, complete } from "./providers.js";
import { type AiAnnotation, AiAnnotationSchema } from "./schema.js";

export type AnnotateResult = { ok: true; annotation: AiAnnotation } | { ok: false; error: string };

export async function annotate(
  graph: TraceGraph,
  repoRoot: string,
  config: AiConfig,
): Promise<AnnotateResult> {
  const { system, user } = buildPrompt(graph, repoRoot);

  let raw: string;
  try {
    raw = await complete(config, system, user);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const first = tryParse(raw);
  if (first) return { ok: true, annotation: first };

  // one repair attempt (Appendix A), then degrade
  try {
    const repaired = await complete(
      config,
      system,
      `${user}\n\nYour previous reply was invalid — it did not parse as the required JSON object. Reply again with ONLY the JSON object, no prose, no code fences.`,
    );
    const second = tryParse(repaired);
    if (second) return { ok: true, annotation: second };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: false, error: "AI reply did not match the annotation schema (after retry)" };
}

function tryParse(raw: string): AiAnnotation | null {
  // strip markdown fences and any leading/trailing prose around the outer object
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = AiAnnotationSchema.safeParse(JSON.parse(candidate.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
