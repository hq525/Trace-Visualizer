import { useCallback, useEffect, useMemo, useState } from "react";
import { type TraceGraph, fetchGraph, postTrace } from "./api.js";
import { GraphView } from "./components/GraphView.js";
import { Legend } from "./components/Legend.js";
import { PasteBox } from "./components/PasteBox.js";
import { SidePanel } from "./components/SidePanel.js";
import { layoutGraph } from "./layout.js";

type Phase = { kind: "loading" } | { kind: "empty" } | { kind: "graph"; graph: TraceGraph };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchGraph().then((graph) => {
      if (graph) {
        setPhase({ kind: "graph", graph });
        setSelectedId(graph.nodes.find((n) => n.crash)?.id ?? null);
      } else {
        setPhase({ kind: "empty" });
      }
    });
  }, []);

  const onPaste = useCallback(async (text: string) => {
    const result = await postTrace(text);
    if (result.ok) {
      setPhase({ kind: "graph", graph: result.graph });
      setSelectedId(result.graph.nodes.find((n) => n.crash)?.id ?? null);
      setToast(null);
    } else {
      setToast(result.message);
    }
  }, []);

  const layout = useMemo(() => (phase.kind === "graph" ? layoutGraph(phase.graph) : null), [phase]);

  const spineIds = useMemo(
    () => (layout ? layout.nodes.filter((p) => p.node.onSpine).map((p) => p.node.id) : []),
    [layout],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (spineIds.length === 0) return;
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const at = selectedId ? spineIds.indexOf(selectedId) : -1;
      const next =
        ev.key === "ArrowRight"
          ? Math.min(spineIds.length - 1, at + 1)
          : Math.max(0, at === -1 ? spineIds.length - 1 : at - 1);
      setSelectedId(spineIds[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spineIds, selectedId]);

  if (phase.kind === "loading") {
    return <div className="h-full grid place-items-center text-[var(--muted)]">loading…</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-[var(--line)] bg-[#10152a]">
        <div className="flex items-baseline gap-2">
          <b className="font-semibold tracking-wide">crashpath</b>
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
            post-mortem
          </span>
        </div>
        {phase.kind === "graph" && (
          <div
            className="mono flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px]"
            style={{
              background: "rgba(255,77,94,.08)",
              border: "1px solid rgba(255,77,94,.35)",
            }}
          >
            <span className="font-semibold text-[var(--hot)]">{phase.graph.exception.type}</span>
            <span>{firstLine(phase.graph.exception.message)}</span>
          </div>
        )}
        <div className="flex-1" />
        {phase.kind === "graph" && (
          <span className="mono text-[12px] text-[var(--muted)] border border-[var(--line)] rounded-full px-3 py-1">
            {phase.graph.meta.repo} · {phase.graph.meta.resolvedFrames}/
            {phase.graph.meta.totalFrames} frames resolved
          </span>
        )}
      </header>

      {phase.kind === "empty" ? (
        <PasteBox onSubmit={onPaste} />
      ) : (
        <>
          <div className="flex items-center px-5 py-2 border-b border-[var(--line)] bg-[var(--board)]">
            <Legend />
          </div>
          <main className="flex flex-1 min-h-0">
            <div className="board flex-1 overflow-auto">
              {layout && (
                <GraphView layout={layout} selectedId={selectedId} onSelect={setSelectedId} />
              )}
            </div>
            {phase.kind === "graph" && (
              <SidePanel
                graph={phase.graph}
                node={phase.graph.nodes.find((n) => n.id === selectedId) ?? null}
              />
            )}
          </main>
        </>
      )}

      {toast && (
        <button
          type="button"
          onClick={() => setToast(null)}
          className="mono fixed bottom-5 left-1/2 -translate-x-1/2 max-w-[640px] whitespace-pre-wrap rounded-md border border-[rgba(255,77,94,.45)] bg-[#2a1520] px-4 py-3 text-left text-[12px] text-[#ffd7db]"
        >
          {toast}
        </button>
      )}
    </div>
  );
}

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return nl === -1 ? s : `${s.slice(0, nl)} …`;
}
