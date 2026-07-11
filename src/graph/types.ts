// TraceGraph schema (plan.md §5.9). `--json` dumps exactly this; it is the
// API contract for the UI, exports, MCP, and tests.
import type { SymbolInfo } from "../analyze/types.js";
import type { Frame } from "../parsers/types.js";

/** Blast-radius discovery output (§5.8): a function 1 hop off the spine. */
export interface RadiusCandidate {
  file: string;
  symbol: SymbolInfo;
  direction: "caller" | "callee";
}

export type NodeKind = "function" | "class" | "file" | "external-chip" | "unresolved";

export interface GraphNode {
  /** stable hash(file + qualifiedName) for resolved nodes */
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName?: string;
  file?: string;
  span?: [number, number];
  onSpine: boolean;
  /** position on trace path (global frame index of the first frame) */
  frameIndex?: number;
  /** exact frame line (extension to §5.9; the code panel focuses it) */
  line?: number;
  crash?: boolean;
  badges: string[];
  /** for external chips */
  collapsedFrames?: Frame[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "trace" | "call" | "import" | "ghost";
  evidence: "runtime" | "static";
  ghostHint?: string;
}

export interface TraceGraph {
  exception: { type: string; message: string };
  chained?: Array<{ relation: "cause" | "context"; graph: TraceGraph }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    repo: string;
    ref?: string;
    resolvedFrames: number;
    totalFrames: number;
    language: string;
  };
}
