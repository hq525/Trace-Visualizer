export interface SymbolInfo {
  name: string;
  /** class-qualified, e.g. "OrderStore.get" */
  qualifiedName: string;
  kind: "function" | "class";
  /** 1-based inclusive line span; for decorated defs, starts at the `def` line */
  span: [number, number];
  decorators: string[];
}

export interface CallSite {
  calleeName: string;
  line: number;
  /** innermost enclosing function name, absent at module/class level */
  enclosing?: string;
}

export interface ImportInfo {
  module: string;
  names: string[];
  line: number;
}

export interface FileAnalysis {
  file: string;
  symbols: SymbolInfo[];
  calls: CallSite[];
  imports: ImportInfo[];
  lineCount: number;
  /** true when the file exceeded the 2 MB cap and was not parsed */
  skipped?: boolean;
}
