import type { TraceGraph } from "../../src/graph/types.js";

export type { GraphEdge, GraphNode, TraceGraph } from "../../src/graph/types.js";

export interface SourceSnippet {
  file: string;
  start: number;
  focus: number;
  lines: string[];
}

export async function fetchGraph(): Promise<TraceGraph | null> {
  const res = await fetch("/api/graph");
  if (!res.ok) return null;
  return (await res.json()) as TraceGraph;
}

export interface TraceSummary {
  index: number;
  language: string;
  exceptionType: string;
  message: string;
  frameCount: number;
  count: number;
}

export type PostTraceResult =
  | { ok: true; graph: TraceGraph }
  | { ok: true; picker: TraceSummary[] }
  | { ok: false; message: string };

export async function postTrace(text: string, pick?: number): Promise<PostTraceResult> {
  const res = await fetch("/api/trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pick === undefined ? { text } : { text, pick }),
  });
  const body = (await res.json()) as TraceGraph & {
    message?: string;
    picker?: TraceSummary[];
  };
  if (!res.ok) return { ok: false, message: body.message ?? `server error ${res.status}` };
  if (body.picker) return { ok: true, picker: body.picker };
  return { ok: true, graph: body };
}

export async function fetchSource(file: string, around: number): Promise<SourceSnippet | null> {
  const res = await fetch(
    `/api/source?file=${encodeURIComponent(file)}&around=${encodeURIComponent(around)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as SourceSnippet;
}
