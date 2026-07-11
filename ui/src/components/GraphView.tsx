import type { Layout, PlacedNode } from "../layout.js";

export function GraphView({
  layout,
  selectedId,
  onSelect,
  ghostOnly = false,
}: {
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  ghostOnly?: boolean;
}) {
  const crash = layout.nodes.find((p) => p.node.crash);
  const ghostEndpoints = new Set(
    layout.edges.filter((e) => e.kind === "ghost").flatMap((e) => [e.fromId, e.toId]),
  );
  const dimmed = (on: boolean) => (ghostOnly && !on ? { opacity: 0.15 } : undefined);
  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Failure path through the codebase"
      className="block"
    >
      {layout.edges
        .filter((e) => e.kind !== "trace" && e.kind !== "ghost")
        .map((e) => (
          <path key={e.id} className={`edge-${e.kind}`} d={e.path} style={dimmed(false)} />
        ))}
      {layout.edges
        .filter((e) => e.kind === "trace")
        .map((e, i) => (
          <path
            key={e.id}
            className="edge-trace draw"
            d={e.path}
            style={{ animationDelay: `${i * 0.09}s`, ...dimmed(false) }}
          />
        ))}
      {layout.edges
        .filter((e) => e.kind === "ghost")
        .map((e) => (
          <g key={e.id} data-ghost>
            <path className="edge-ghost" d={e.path} />
            {e.labelX !== undefined && (
              <>
                <text className="ghost-glyph" x={e.labelX - 5} y={(e.labelY ?? 0) + 20}>
                  ⚡
                </text>
                <text className="ghost-label" x={e.labelX} y={e.labelY} textAnchor="middle">
                  {e.label}
                </text>
              </>
            )}
          </g>
        ))}
      {crash && (
        <circle className="pulse" cx={crash.x + crash.w / 2} cy={crash.y + crash.h / 2} r={40} />
      )}
      {layout.nodes.map((p) => (
        <g key={p.node.id} style={dimmed(ghostEndpoints.has(p.node.id))}>
          <Node placed={p} selected={p.node.id === selectedId} onSelect={onSelect} />
        </g>
      ))}
    </svg>
  );
}

function Node({
  placed,
  selected,
  onSelect,
}: {
  placed: PlacedNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { node, x, y, w, h } = placed;
  const cx = x + w / 2;
  const isChip = node.kind === "external-chip";
  const classes = [
    "node",
    `kind-${node.kind}`,
    node.crash ? "crash" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav is global (←/→)
    <g
      className={classes}
      data-node={node.id}
      data-kind={node.kind}
      onClick={() => onSelect(node.id)}
    >
      <rect x={x} y={y} width={w} height={h} rx={isChip ? 16 : 7} />
      {!isChip && node.frameIndex !== undefined && (
        <text className="idx" x={x + 8} y={y + 13}>
          {node.frameIndex}
        </text>
      )}
      <text className="fn" x={cx} y={y + (isChip ? h / 2 + 4 : 22)} textAnchor="middle">
        {truncate(node.name, 15)}
      </text>
      {!isChip && (
        <text className="file" x={cx} y={y + 37} textAnchor="middle">
          {node.file ? `${baseName(node.file)}${node.line ? `:${node.line}` : ""}` : "unresolved"}
        </text>
      )}
    </g>
  );
}

function baseName(p: string): string {
  const segs = p.split("/");
  return segs[segs.length - 1];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
