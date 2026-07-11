#!/usr/bin/env node
// Phase 0 throwaway: frame -> symbol resolution via web-tree-sitter (plan §5.5).
// Usage: node spike/resolve.mjs --repo <root> <trace.txt> [more traces...]
// Prints per-frame resolution and the gate metric.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";

const Language = { load: (p) => Parser.Language.load(p) };
import { extractTraces } from "./parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.join(HERE, "node_modules", "tree-sitter-wasms", "out");

const args = process.argv.slice(2);
const repoRoot = path.resolve(args[args.indexOf("--repo") + 1]);
const traceFiles = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--repo");

await Parser.init();
const languages = {};
async function langFor(file) {
  const ext = path.extname(file);
  const name = ext === ".py" ? "python" : ext === ".ts" ? "typescript" : "javascript";
  languages[name] ??= await Language.load(
    path.join(WASM_DIR, `tree-sitter-${name}.wasm`),
  );
  return languages[name];
}

// ---- symbol table: function-like nodes with names + spans ----

const PY_FN = new Set(["function_definition"]);
const JS_FN = new Set([
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "function_expression",
  "function",
  "arrow_function",
]);

function nameOfFn(node, langName) {
  if (langName === "python") return node.childForFieldName("name")?.text ?? null;
  // js: declarations/methods carry a name; expressions borrow the binding site
  const own = node.childForFieldName("name")?.text;
  if (own) return own;
  const p = node.parent;
  if (!p) return null;
  if (p.type === "variable_declarator" || p.type === "public_field_definition")
    return p.childForFieldName("name")?.text ?? null;
  if (p.type === "pair") return p.childForFieldName("key")?.text ?? null;
  if (p.type === "assignment_expression") {
    const left = p.childForFieldName("left")?.text ?? "";
    return left.split(".").pop() || null;
  }
  return null;
}

const fileCache = new Map();
async function symbolsOf(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  const lang = await langFor(file);
  const langName = path.extname(file) === ".py" ? "python" : "js";
  const parser = new Parser();
  parser.setLanguage(lang);
  const src = fs.readFileSync(file, "utf8");
  const tree = parser.parse(src);
  const fns = [];
  const stack = [tree.rootNode];
  const fnTypes = langName === "python" ? PY_FN : JS_FN;
  while (stack.length) {
    const n = stack.pop();
    if (fnTypes.has(n.type)) {
      fns.push({
        name: nameOfFn(n, langName),
        start: n.startPosition.row + 1,
        end: n.endPosition.row + 1,
      });
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
  }
  const entry = { fns, lines: src.split("\n").length };
  fileCache.set(file, entry);
  parser.delete();
  return entry;
}

// ---- resolution ----

function collectFrames(trace) {
  const frames = [...trace.frames];
  if (trace.chained) frames.push(...collectFrames(trace.chained.trace));
  return frames;
}

function normSymbol(sym) {
  if (!sym) return null;
  let s = sym.replace(/^async\s+/, "").replace(/^new\s+/, "");
  s = s.replace(/\s\[as .+\]$/, ""); // "Module.f [as g]" -> alias target g is runtime
  const last = s.split(".").pop();
  return { full: s, last };
}

let inRepo = 0;
let nameMatch = 0;
let moduleLevel = 0;
let anonSpan = 0;
let enclosingOnly = 0;
let noNode = 0;
const details = [];

for (const tf of traceFiles) {
  const text = fs.readFileSync(tf, "utf8");
  for (const trace of extractTraces(text)) {
    for (const f of collectFrames(trace)) {
      if (!f.rawPath || f.line == null) continue;
      const abs = path.resolve(f.rawPath.replace(/^file:\/\//, ""));
      if (!abs.startsWith(repoRoot + path.sep)) continue;
      if (!fs.existsSync(abs)) continue;
      inRepo++;
      const { fns } = await symbolsOf(abs);
      const containing = fns
        .filter((fn) => fn.start <= f.line && f.line <= fn.end)
        .sort((a, b) => b.start - a.start); // innermost first
      const sym = normSymbol(f.symbol);
      const rel = path.relative(repoRoot, abs);
      if (!sym || sym.full === "<module>") {
        if (sym == null && containing.length > 0) {
          anonSpan++; // anonymous fn frame resolved by span alone
          details.push(["ANON", rel, f.line, "(anon)", containing[0].name ?? "(anon fn)"]);
        } else {
          moduleLevel++; // Python `<module>` / JS top-level -> file node
          details.push(["MODULE", rel, f.line, f.symbol ?? "(anon)", containing[0]?.name ?? "-"]);
        }
        continue;
      }
      if (containing.length === 0) {
        noNode++;
        details.push(["NONODE", rel, f.line, f.symbol, "-"]);
        continue;
      }
      const inner = containing[0];
      // innermost node may be an anonymous wrapper; accept a match anywhere in
      // the containing chain ONLY at the innermost NAMED node
      const innerNamed = containing.find((c) => c.name);
      if (
        inner.name === sym.last ||
        inner.name === sym.full ||
        (inner.name == null && innerNamed?.name === sym.last)
      ) {
        nameMatch++;
        details.push(["MATCH", rel, f.line, f.symbol, inner.name ?? `(anon)>${innerNamed?.name}`]);
      } else {
        enclosingOnly++;
        details.push(["MISMATCH", rel, f.line, f.symbol, inner.name ?? "(anon)"]);
      }
    }
  }
}

for (const [tag, rel, line, sym, got] of details) {
  console.log(`${tag.padEnd(9)} ${rel}:${line}  trace='${sym}'  ts='${got}'`);
}
const resolved = nameMatch + moduleLevel + anonSpan;
console.log(
  `\nin-repo frames: ${inRepo} | name-match: ${nameMatch} | anon-span: ${anonSpan} | module-level: ${moduleLevel} | enclosing-only: ${enclosingOnly} | no-node: ${noNode}`,
);
console.log(`resolution rate: ${resolved}/${inRepo} (${((100 * resolved) / inRepo).toFixed(1)}%)`);
