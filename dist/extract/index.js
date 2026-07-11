// Dirty text → ExtractedTrace[] (plan.md §5.1). Ported from the Phase 0 spike.
// Handles JSON-wrapped log lines, per-line log prefixes (k8s CRI, ISO+level,
// NestJS), then anchors Python/V8 blocks.
import { isGroupAnchor, PY_ANCHOR, parsePythonChain } from "../parsers/python.js";
import { parseV8Block, V8_AT, V8_HEADER } from "../parsers/v8.js";
const PREFIX_PATTERNS = [
    // k8s CRI: 2026-07-11T03:25:44.118437221Z stderr F <line>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z (?:stdout|stderr) [PF] /,
    // ISO timestamp + [LEVEL]: Azure/app-service style `2023-…Z: [ERROR] <line>`
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?:? \[(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\] /i,
    // NestJS: `[Nest] 42467  - 02/28/2026, 1:16:04 PM   ERROR [ExceptionHandler] <line>`
    /^\[Nest\] \d+\s+-\s+[\d/]+,? [\d:]+ (?:AM|PM)?\s*(?:ERROR|WARN|LOG|DEBUG|VERBOSE|FATAL)\s+(?:\[\w+\] )?/,
];
/** Human-readable list for the exit-2 "no trace found" message. */
export const SEARCHED_ANCHORS = [
    'Python:  a line matching "Traceback (most recent call last):"',
    'V8/Node: an error line like "TypeError: …" followed by "    at …" frames',
];
const TRACE_HINT = /Traceback \(most recent call last\)|(?:^|\n)\s*at .+(?::\d+:\d+|\(<anonymous>\)|\(native\))/;
function stripPrefixes(line) {
    for (const re of PREFIX_PATTERNS) {
        const m = line.match(re);
        if (m)
            return line.slice(m[0].length);
    }
    return line;
}
/** Expand JSON log lines whose string fields embed a trace; strip per-line prefixes. */
export function cleanInput(text) {
    const out = [];
    for (const rawLine of text.split("\n")) {
        const line = stripPrefixes(rawLine);
        const trimmed = line.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            let obj = null;
            try {
                obj = JSON.parse(trimmed);
            }
            catch {
                obj = null;
            }
            if (obj && typeof obj === "object") {
                let found = false;
                for (const v of walkStrings(obj)) {
                    if (TRACE_HINT.test(v)) {
                        out.push(...v.split("\n"));
                        found = true;
                    }
                }
                if (found)
                    continue;
            }
        }
        out.push(line);
    }
    return out;
}
function* walkStrings(obj, depth = 0) {
    if (depth > 3)
        return;
    for (const v of Object.values(obj)) {
        if (typeof v === "string")
            yield v;
        else if (v && typeof v === "object")
            yield* walkStrings(v, depth + 1);
    }
}
export function extractTraces(text) {
    const lines = cleanInput(text);
    const traces = [];
    let i = 0;
    while (i < lines.length) {
        if (PY_ANCHOR.test(lines[i]) || isGroupAnchor(lines[i])) {
            const r = parsePythonChain(lines, i);
            traces.push({ language: "python", ...r.trace });
            i = r.next;
        }
        else if (V8_HEADER.test(lines[i]) && V8_AT.test(lines[i + 1] ?? "")) {
            const r = parseV8Block(lines, i);
            traces.push({ language: "js", ...r.trace });
            i = r.next;
        }
        else {
            i++;
        }
    }
    return traces;
}
