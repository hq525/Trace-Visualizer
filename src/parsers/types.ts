// Core parse-stage types (plan.md §5.2). Frames are ALWAYS normalized
// root-call → crash order, regardless of how the runtime printed them.

export interface Frame {
  rawPath: string;
  /** null for frames with no location (e.g. V8 "<anonymous>") */
  line: number | null;
  column?: number;
  /** function/method name exactly as printed by the runtime */
  symbol?: string;
  /** stdlib / site-packages / node_modules / node:internal */
  isExternal: boolean;
  /** "[Previous line repeated N more times]" */
  repeated?: number;
  /** an at-line we could not decompose; kept visible, never resolved */
  unparsed?: boolean;
}

export interface ParsedTrace {
  exception: { type: string; message: string };
  frames: Frame[];
  chained?: { relation: "cause" | "context"; trace: ParsedTrace };
  /** SyntaxError-family error location (not a call frame) */
  location?: { rawPath: string; line: number | null };
}

export interface ExtractedTrace extends ParsedTrace {
  language: "python" | "js";
}

export function isExternalPythonPath(p: string): boolean {
  return (
    p.includes("/site-packages/") ||
    p.includes("/dist-packages/") ||
    p.includes("/lib/python3.") ||
    p.startsWith("<")
  );
}

export function isExternalJsPath(p: string): boolean {
  return (
    p.startsWith("node:") ||
    p.startsWith("internal/") ||
    p.includes("/node_modules/") ||
    p === "<anonymous>" ||
    p === "<elided>"
  );
}
