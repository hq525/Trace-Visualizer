// Per-file JS/TS analysis via tree-sitter (plan.md §5.4): declarations,
// class methods, arrows/functions bound to names, imports (incl. require),
// name-level call sites. No type inference.
import type Parser from "web-tree-sitter";
import { getParser, grammarForFile } from "./treesitter.js";
import type { CallSite, FileAnalysis, SymbolInfo } from "./types.js";

const MAX_FILE_BYTES = 2_000_000;
const FN_VALUE_TYPES = new Set(["arrow_function", "function_expression", "function"]);

export async function analyzeJsSource(file: string, source: string): Promise<FileAnalysis> {
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
  const grammar = grammarForFile(file) ?? "javascript";
  const parser = await getParser(grammar === "python" ? "javascript" : grammar);
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
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        emitFunction(name, node, ctx, out);
        recurseBody(node, { ...ctx, fns: [...ctx.fns, name] }, out);
        return;
      }
      break;
    }
    case "class_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.symbols.push({
          name,
          qualifiedName: [...ctx.classes, name].join("."),
          kind: "class",
          span: [line1(node), node.endPosition.row + 1],
          decorators: [],
        });
        recurseBody(node, { ...ctx, classes: [...ctx.classes, name] }, out);
        return;
      }
      break;
    }
    case "method_definition": {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        emitFunction(name, node, ctx, out);
        recurseBody(node, { ...ctx, fns: [...ctx.fns, name] }, out);
        return;
      }
      break;
    }
    case "public_field_definition":
    case "variable_declarator":
    case "pair": {
      const value = node.childForFieldName("value");
      if (value && FN_VALUE_TYPES.has(value.type)) {
        const nameNode =
          node.type === "pair"
            ? node.childForFieldName("key")
            : (node.childForFieldName("name") ?? node.childForFieldName("property"));
        const name = nameNode?.text;
        if (name) {
          emitFunction(name, value, ctx, out);
          recurseBody(value, { ...ctx, fns: [...ctx.fns, name] }, out);
          return;
        }
      }
      break;
    }
    case "assignment_expression": {
      const value = node.childForFieldName("right");
      if (value && FN_VALUE_TYPES.has(value.type)) {
        const left = node.childForFieldName("left")?.text ?? "";
        const name = left.split(".").pop();
        if (name) {
          emitFunction(name, value, ctx, out);
          recurseBody(value, { ...ctx, fns: [...ctx.fns, name] }, out);
          return;
        }
      }
      break;
    }
    case "import_statement": {
      const sourceNode = node.childForFieldName("source");
      const module = stripQuotes(sourceNode?.text ?? "");
      const names: string[] = [];
      const clause = node.namedChildren.find((c) => c.type === "import_clause");
      if (clause) collectImportNames(clause, names);
      if (module) out.imports.push({ module, names, line: line1(node) });
      return;
    }
    case "call_expression": {
      const fn = node.childForFieldName("function");
      // const x = require("mod")
      if (fn?.type === "identifier" && fn.text === "require") {
        const arg = node.childForFieldName("arguments")?.namedChildren[0];
        if (arg?.type === "string") {
          const binding =
            node.parent?.type === "variable_declarator"
              ? node.parent.childForFieldName("name")?.text
              : undefined;
          out.imports.push({
            module: stripQuotes(arg.text),
            names: binding ? [binding] : [],
            line: line1(node),
          });
          return;
        }
      }
      const calleeName =
        fn?.type === "identifier"
          ? fn.text
          : fn?.type === "member_expression"
            ? (fn.childForFieldName("property")?.text ?? null)
            : null;
      if (calleeName) pushCall(calleeName, node, ctx, out);
      break; // recurse: callbacks/nested calls in arguments
    }
    case "new_expression": {
      const ctor = node.childForFieldName("constructor");
      const calleeName =
        ctor?.type === "identifier"
          ? ctor.text
          : ctor?.type === "member_expression"
            ? (ctor.childForFieldName("property")?.text ?? null)
            : null;
      if (calleeName) pushCall(calleeName, node, ctx, out);
      break;
    }
    default:
      break;
  }
  for (const child of node.namedChildren) walk(child, ctx, out);
}

function emitFunction(name: string, fnNode: Parser.SyntaxNode, ctx: Ctx, out: FileAnalysis): void {
  out.symbols.push({
    name,
    qualifiedName: [...ctx.classes, name].join("."),
    kind: "function",
    span: [line1(fnNode), fnNode.endPosition.row + 1],
    decorators: [],
  });
}

function recurseBody(node: Parser.SyntaxNode, ctx: Ctx, out: FileAnalysis): void {
  const body = node.childForFieldName("body");
  if (!body) return;
  for (const child of body.namedChildren) walk(child, ctx, out);
}

function pushCall(calleeName: string, node: Parser.SyntaxNode, ctx: Ctx, out: FileAnalysis): void {
  const site: CallSite = { calleeName, line: line1(node) };
  const enclosing = ctx.fns[ctx.fns.length - 1];
  if (enclosing) site.enclosing = enclosing;
  out.calls.push(site);
}

function collectImportNames(clause: Parser.SyntaxNode, names: string[]): void {
  for (const child of clause.namedChildren) {
    if (child.type === "identifier") {
      names.push(child.text); // default import
    } else if (child.type === "named_imports") {
      for (const spec of child.namedChildren) {
        if (spec.type !== "import_specifier") continue;
        const alias = spec.childForFieldName("alias")?.text;
        const name = spec.childForFieldName("name")?.text;
        const bound = alias ?? name;
        if (bound) names.push(bound);
      }
    } else if (child.type === "namespace_import") {
      const id = child.namedChildren.find((c) => c.type === "identifier");
      if (id) names.push(id.text);
    }
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^["'`]|["'`]$/g, "");
}

function line1(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}
