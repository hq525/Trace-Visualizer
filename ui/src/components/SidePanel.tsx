import { useEffect, useState } from "react";
import {
  type AiAnnotation,
  type GraphNode,
  type SourceSnippet,
  type TraceGraph,
  fetchSource,
} from "../api.js";

export interface AiPanelProps {
  annotation: AiAnnotation | null;
  busy: boolean;
  onAnalyze: () => void;
}

export function SidePanel({
  graph,
  node,
  ai = null,
}: {
  graph: TraceGraph;
  node: GraphNode | null;
  ai?: AiPanelProps | null;
}) {
  const [snippet, setSnippet] = useState<SourceSnippet | null>(null);

  useEffect(() => {
    setSnippet(null);
    if (node?.file && node.line) {
      fetchSource(node.file, node.line).then(setSnippet);
    }
  }, [node]);

  if (!node) {
    return (
      <aside className="w-[360px] flex-none border-l border-[var(--line)] bg-[var(--panel)] p-5 text-[13px] text-[var(--faint)]">
        Click a node — or walk the spine with ← → .{ai && <AiSection ai={ai} node={null} />}
      </aside>
    );
  }

  const inEdges = graph.edges.filter((e) => e.to === node.id);
  const outEdges = graph.edges.filter((e) => e.from === node.id);
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <aside
      className="w-[360px] flex-none overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)]"
      data-panel
    >
      <div className="border-b border-[var(--line)] px-4 py-4">
        <div className="mono flex items-center gap-2 text-[15px] font-semibold">
          {node.crash && (
            <span
              className="inline-block h-2 w-2 rounded-full bg-[var(--hot)]"
              style={{ boxShadow: "0 0 8px rgba(255,77,94,.8)" }}
            />
          )}
          {node.name}
        </div>
        {node.file && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(`${node.file}:${node.line ?? ""}`)}
            className="mono mt-2 text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
            title="copy path"
          >
            {node.file}
            {node.line ? `:${node.line}` : ""} ⧉
          </button>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {node.crash && <Badge tone="hot">crash</Badge>}
          {node.onSpine && <Badge tone="ok">runtime fact</Badge>}
          {node.badges.map((b) => (
            <Badge key={b} tone="warn">
              {b}
            </Badge>
          ))}
        </div>
      </div>

      {node.kind === "external-chip" && node.collapsedFrames && (
        <div className="border-b border-[var(--line)] px-4 py-3">
          <Cap>collapsed frames</Cap>
          {node.collapsedFrames.slice(0, 8).map((f, i) => (
            <div
              key={`${f.rawPath}:${String(f.line)}:${String(i)}`}
              className="mono truncate py-0.5 text-[11px] text-[var(--muted)]"
            >
              {f.symbol ?? "…"} · {f.rawPath.split("/").slice(-2).join("/")}
              {f.line ? `:${f.line}` : ""}
            </div>
          ))}
          {node.collapsedFrames.length > 8 && (
            <div className="mono pt-1 text-[11px] text-[var(--faint)]">
              +{node.collapsedFrames.length - 8} more
            </div>
          )}
        </div>
      )}

      {snippet && (
        <div className="border-b border-[var(--line)] py-3">
          <div className="px-4 pb-2">
            <Cap>source · ±10 lines</Cap>
          </div>
          <pre className="mono overflow-x-auto text-[11.5px]" data-snippet>
            {snippet.lines.map((line, i) => {
              const no = snippet.start + i;
              return (
                <span key={no} className={`ln${no === snippet.focus ? " hot" : ""}`}>
                  <span className="no">{no}</span>
                  <span className="src">{line || " "}</span>
                </span>
              );
            })}
          </pre>
        </div>
      )}

      {(inEdges.length > 0 || outEdges.length > 0) && (
        <div className="px-4 py-3">
          <Cap>edges</Cap>
          {inEdges.map((e) => (
            <EdgeRow key={e.id} dir="←" name={nameOf(e.from)} kind={e.kind} />
          ))}
          {outEdges.map((e) => (
            <EdgeRow key={e.id} dir="→" name={nameOf(e.to)} kind={e.kind} />
          ))}
        </div>
      )}

      {ai && <AiSection ai={ai} node={node} />}
    </aside>
  );
}

/** §3.4: everything below is INFERENCE, clearly badged — never graph truth. */
function AiSection({ ai, node }: { ai: AiPanelProps; node: GraphNode | null }) {
  const a = ai.annotation;
  const frameNote =
    a && node?.frameIndex !== undefined
      ? a.per_frame_notes.find((n) => n.frameIndex === node.frameIndex)
      : undefined;
  return (
    <div
      className="border-t-2 border-[rgba(179,136,255,.35)] px-4 py-3"
      data-ai-panel
      style={{ background: "rgba(179,136,255,.04)" }}
    >
      <div className="flex items-center gap-2 pb-2">
        <span className="rounded border border-[rgba(179,136,255,.4)] bg-[rgba(179,136,255,.1)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--ghost)]">
          ✨ AI inference
        </span>
        <button
          type="button"
          onClick={ai.onAnalyze}
          disabled={ai.busy}
          data-ai-analyze
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          {ai.busy ? "analyzing…" : a ? "regenerate" : "analyze"}
        </button>
      </div>
      {!a ? (
        <p className="text-[12px] text-[var(--faint)]">
          Optional hypothesis from your configured model. The graph above stays ground truth.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          <p className="text-[var(--text)]">
            {a.root_cause_hypothesis}{" "}
            <span className="text-[var(--faint)]">({a.confidence} confidence)</span>
          </p>
          {frameNote && (
            <p className="mono text-[11px] text-[var(--muted)]">this frame: {frameNote.note}</p>
          )}
          {a.ghost_edge_explanations.length > 0 && (
            <div>
              <Cap>ghost edges, explained</Cap>
              {a.ghost_edge_explanations.map((g) => (
                <p key={g.edgeId} className="mono text-[11px] text-[var(--muted)]">
                  {g.mechanism}: {g.explanation}
                </p>
              ))}
            </div>
          )}
          {a.suggested_fix && (
            <div>
              <Cap>suggested fix</Cap>
              <p className="mono text-[11px] text-[var(--muted)]">
                {a.suggested_fix.file}: {a.suggested_fix.description}
              </p>
              {a.suggested_fix.diff && (
                <pre className="mono mt-1 overflow-x-auto rounded border border-[var(--line)] p-2 text-[10.5px] text-[#c3e88d]">
                  {a.suggested_fix.diff}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--faint)]">
      {children}
    </div>
  );
}

function Badge({ tone, children }: { tone: "hot" | "ok" | "warn"; children: React.ReactNode }) {
  const styles = {
    hot: "border-[rgba(255,77,94,.4)] bg-[rgba(255,77,94,.12)] text-[var(--hot)]",
    ok: "border-[rgba(57,217,138,.3)] bg-[rgba(57,217,138,.08)] text-[var(--ok)]",
    warn: "border-[rgba(255,203,107,.35)] bg-[rgba(255,203,107,.08)] text-[#ffcb6b]",
  }[tone];
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${styles}`}>
      {children}
    </span>
  );
}

function EdgeRow({ dir, name, kind }: { dir: string; name: string; kind: string }) {
  return (
    <div className="mono flex items-center gap-2 py-1 text-[12px] text-[var(--muted)]">
      <span className="w-4 text-center text-[var(--faint)]">{dir}</span>
      <span className="truncate">{name}</span>
      <span
        className={`ml-auto rounded border px-1.5 text-[9px] uppercase tracking-wider ${
          kind === "trace"
            ? "border-[rgba(255,77,94,.35)] text-[var(--hot)]"
            : "border-[var(--line)] text-[var(--muted)]"
        }`}
      >
        {kind === "trace" ? "runtime" : "static"}
      </span>
    </div>
  );
}
