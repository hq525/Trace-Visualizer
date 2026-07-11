// AI prompt assembly (§3.4): exception + resolved frames with ±5-line
// snippets + ghost edges + radius names. Budget ≈3–5k tokens — the payload is
// small enough for a 3B local model.
import fs from "node:fs";
import path from "node:path";
import type { GraphNode, TraceGraph } from "../graph/types.js";

const SNIPPET_RADIUS = 5;

export const SYSTEM_PROMPT = `You are crashpath's annotation assistant. You annotate an EXISTING failure graph; you cannot add nodes or edges. Cite frames by their frameIndex. If the evidence is insufficient, say "insufficient information" rather than guess.
Reply with ONLY a JSON object matching:
{
  "root_cause_hypothesis": "2-4 sentences, must reference specific frames by index",
  "confidence": "low | medium | high",
  "per_frame_notes": [{ "frameIndex": 0, "note": "<=140 chars" }],
  "ghost_edge_explanations": [{ "edgeId": "...", "mechanism": "...", "explanation": "..." }],
  "suggested_fix": { "file": "...", "description": "...", "diff": "optional unified diff" }
}`;

export function buildPrompt(graph: TraceGraph, repoRoot: string): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Exception: ${graph.exception.type}: ${graph.exception.message}`);
  lines.push("");
  lines.push("Failure path (root call → crash), resolved frames only:");

  const spine = graph.nodes
    .filter((n) => n.onSpine && n.kind !== "external-chip")
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
  for (const node of spine) {
    lines.push(
      `- frameIndex ${node.frameIndex}: ${node.qualifiedName ?? node.name} (${node.file ?? "unresolved"}:${node.line ?? "?"})${node.crash ? "  ← CRASH" : ""}`,
    );
    const snippet = readSnippet(node, repoRoot);
    if (snippet) lines.push(indent(snippet));
  }

  const ghosts = graph.edges.filter((e) => e.kind === "ghost");
  if (ghosts.length > 0) {
    lines.push("");
    lines.push("Ghost edges (runtime hops with NO static call edge — dynamic dispatch):");
    const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;
    for (const g of ghosts) {
      lines.push(`- ${g.id}: ${nameOf(g.from)} → ${nameOf(g.to)} (hint: ${g.ghostHint})`);
    }
  }

  const radius = graph.nodes.filter((n) => !n.onSpine);
  if (radius.length > 0) {
    lines.push("");
    lines.push(`Blast radius (1-hop context): ${radius.map((n) => n.name).join(", ")}`);
  }

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

function readSnippet(node: GraphNode, repoRoot: string): string | null {
  if (!node.file || !node.line) return null;
  try {
    const all = fs.readFileSync(path.join(repoRoot, node.file), "utf8").split("\n");
    const focus = Math.min(Math.max(1, node.line), all.length);
    const start = Math.max(1, focus - SNIPPET_RADIUS);
    const end = Math.min(all.length, focus + SNIPPET_RADIUS);
    return all
      .slice(start - 1, end)
      .map((l, i) => `${start + i === focus ? ">" : " "} ${start + i} | ${l}`)
      .join("\n");
  } catch {
    return null;
  }
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
