import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";
let initPromise = null;
let pythonLanguage = null;
/** Lazily initialize the WASM runtime and the Python grammar (loaded once). */
export async function getPythonParser() {
    if (!initPromise)
        initPromise = Parser.init();
    await initPromise;
    if (!pythonLanguage) {
        const wasmPath = fileURLToPath(new URL("../../grammars/tree-sitter-python.wasm", import.meta.url));
        pythonLanguage = await Parser.Language.load(wasmPath);
    }
    const parser = new Parser();
    parser.setLanguage(pythonLanguage);
    return parser;
}
