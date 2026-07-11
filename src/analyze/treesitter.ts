import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

export type GrammarName = "python" | "javascript" | "typescript" | "tsx";

let initPromise: Promise<void> | null = null;
const languages = new Map<GrammarName, Parser.Language>();

/** Lazily initialize the WASM runtime; load each grammar at most once. */
export async function getParser(grammar: GrammarName): Promise<Parser> {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
  let language = languages.get(grammar);
  if (!language) {
    const wasmPath = fileURLToPath(
      new URL(`../../grammars/tree-sitter-${grammar}.wasm`, import.meta.url),
    );
    language = await Parser.Language.load(wasmPath);
    languages.set(grammar, language);
  }
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export async function getPythonParser(): Promise<Parser> {
  return getParser("python");
}

export function grammarForFile(file: string): GrammarName | null {
  const lower = file.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts"))
    return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return "javascript";
  return null;
}
