// Per-file Python analysis via tree-sitter (plan.md §5.4): symbol table with
// spans + decorators, import list, name-level call sites. No type inference.
import type Parser from "web-tree-sitter";
import { getPythonParser } from "./treesitter.js";
import type { CallSite, FileAnalysis, ImportInfo, SymbolInfo } from "./types.js";

const MAX_FILE_BYTES = 2_000_000;

export async function analyzePythonSource(file: string, source: string): Promise<FileAnalysis> {
  const base: FileAnalysis = {
    file,
    symbols: [],
    calls: [],
    imports: [],
    lineCount: source.split("\n").length,
  };
  if (Buffer.byteLength(source) > MAX_FILE_BYTES) {
    return { ...base, skipped: true };
  }
  const parser = await getPythonParser();
  const tree = parser.parse(source);
  try {
    walk(tree.rootNode, { classes: [], fns: [] }, base);
  } finally {
    tree.delete();
    parser.delete();
  }
  return base;
}

interface Ctx {
  classes: string[];
  fns: string[];
}

function walk(node: Parser.SyntaxNode, ctx: Ctx, out: FileAnalysis): void {
  switch (node.type) {
    case "decorated_definition": {
      const decorators = node.children
        .filter((c) => c.type === "decorator")
        .map(decoratorName)
        .filter((d): d is string => d !== null);
      const def = node.childForFieldName("definition");
      if (def) handleDefinition(def, decorators, ctx, out);
      return;
    }
    case "function_definition":
    case "class_definition":
      handleDefinition(node, [], ctx, out);
      return;
    case "import_statement": {
      for (const child of node.namedChildren) {
        if (child.type === "dotted_name") {
          out.imports.push({ module: child.text, names: [], line: line1(node) });
        } else if (child.type === "aliased_import") {
          const mod = child.childForFieldName("name")?.text;
          if (mod) out.imports.push({ module: mod, names: [], line: line1(node) });
        }
      }
      return;
    }
    case "import_from_statement": {
      const moduleNode = node.childForFieldName("module_name");
      const module = moduleNode?.text ?? "";
      const names: string[] = [];
      for (const child of node.namedChildren) {
        // web-tree-sitter node wrappers are not reference-equal; compare ids
        if (moduleNode && child.id === moduleNode.id) continue;
        if (child.type === "dotted_name") names.push(child.text);
        else if (child.type === "aliased_import") {
          const alias = child.childForFieldName("alias")?.text;
          const name = child.childForFieldName("name")?.text;
          if (alias ?? name) names.push((alias ?? name) as string);
        } else if (child.type === "wildcard_import") {
          names.push("*");
        }
      }
      out.imports.push({ module, names, line: line1(node) });
      return;
    }
    case "call": {
      const fn = node.childForFieldName("function");
      const calleeName =
        fn?.type === "identifier"
          ? fn.text
          : fn?.type === "attribute"
            ? (fn.childForFieldName("attribute")?.text ?? null)
            : null;
      if (calleeName) {
        const site: CallSite = { calleeName, line: line1(node) };
        const enclosing = ctx.fns[ctx.fns.length - 1];
        if (enclosing) site.enclosing = enclosing;
        out.calls.push(site);
      }
      break; // still recurse: nested calls in arguments
    }
    default:
      break;
  }
  for (const child of node.namedChildren) walk(child, ctx, out);
}

function handleDefinition(
  def: Parser.SyntaxNode,
  decorators: string[],
  ctx: Ctx,
  out: FileAnalysis,
): void {
  const name = def.childForFieldName("name")?.text;
  if (!name) return;
  const kind = def.type === "class_definition" ? "class" : "function";
  const symbol: SymbolInfo = {
    name,
    qualifiedName: [...ctx.classes, name].join("."),
    kind,
    span: [line1(def), def.endPosition.row + 1],
    decorators,
  };
  out.symbols.push(symbol);
  const body = def.childForFieldName("body");
  if (!body) return;
  const inner: Ctx =
    kind === "class"
      ? { classes: [...ctx.classes, name], fns: ctx.fns }
      : { classes: ctx.classes, fns: [...ctx.fns, name] };
  for (const child of body.namedChildren) walk(child, inner, out);
}

function line1(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** "@app.get(\"/x\")" → "app.get" · "@staticmethod" → "staticmethod" */
function decoratorName(decorator: Parser.SyntaxNode): string | null {
  const expr = decorator.namedChildren[0];
  if (!expr) return null;
  if (expr.type === "call") return expr.childForFieldName("function")?.text ?? null;
  return expr.text;
}
