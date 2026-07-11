import type { TraceSummary } from "../api.js";

export function TracePicker({
  options,
  onPick,
}: {
  options: TraceSummary[];
  onPick: (index: number) => void;
}) {
  return (
    <div className="board flex flex-1 items-start justify-center p-8">
      <div className="w-full max-w-[680px]">
        <h1 className="mb-1 text-xl font-semibold">This log contains {options.length} traces</h1>
        <p className="mb-5 text-[13px] text-[var(--muted)]">
          Pick the failure to map. Identical traces are grouped.
        </p>
        <div className="flex flex-col gap-2" data-picker>
          {options.map((o) => (
            <button
              key={o.index}
              type="button"
              onClick={() => onPick(o.index)}
              className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-left hover:border-[var(--node-edge)]"
            >
              <span className="rounded border border-[var(--line)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                {o.language}
              </span>
              <span className="mono text-[13px]">
                <span className="font-semibold text-[var(--hot)]">{o.exceptionType}</span>{" "}
                <span className="text-[var(--text)]">{truncate(o.message, 60)}</span>
              </span>
              <span className="mono ml-auto flex-none text-[11px] text-[var(--faint)]">
                {o.frameCount} frames{o.count > 1 ? ` · ×${o.count}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
