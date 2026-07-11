// V8/Node stack parser (plan.md §5.2). Ported from the Phase 0 spike.
// Handles: dotted/async/new symbols, anonymous frames, [cause] chains,
// vitest's ❯ marker, and Node's cause-elision
// ("... N lines matching cause stack trace ...") with frame reconstruction.
import { type Frame, type ParsedTrace, isExternalJsPath } from "./types.js";

export const V8_HEADER =
  /^(?:Uncaught )?([A-Za-z_$][\w$]*(?:Error|Exception)(?:\s\[[A-Z_]+\])?|AssertionError|Error): (.*)$/;
export const V8_AT = /^(\s*)(?:at|❯)\s+(.+)$/; // ❯ = vitest's frame marker
const V8_ELISION = /^\s*\.\.\. (\d+) lines matching cause stack trace \.\.\.$/;

type RawFrame = Frame | { __elide: number };

interface BlockResult {
  trace: ParsedTrace;
  next: number;
}

export function parseV8Block(lines: string[], start: number, baseIndent = -1): BlockResult {
  const headM = lines[start].match(V8_HEADER);
  if (!headM) throw new Error(`parseV8Block called on non-header line: ${lines[start]}`);
  const type = headM[1];
  const message = headM[2];
  let i = start + 1;
  const rawFrames: RawFrame[] = [];
  let atIndent: number | null = null;

  while (i < lines.length) {
    const m = lines[i].match(V8_AT);
    if (m) {
      const indent = m[1].length;
      if (atIndent === null) atIndent = indent;
      if (baseIndent >= 0 && indent <= baseIndent) break; // parent level
      rawFrames.push(parseAtLine(m[2]));
      i++;
      continue;
    }
    const el = lines[i].match(V8_ELISION);
    if (el) {
      rawFrames.push({ __elide: Number(el[1]) });
      i++;
      continue;
    }
    break;
  }

  const trace: ParsedTrace = { exception: { type, message }, frames: [] };

  // [cause]: block (Node >=16.9)
  const causeM = (lines[i] ?? "").match(/^(\s*)\[cause\]: (.+)$/);
  let causeRawFrames: Frame[] | null = null;
  if (causeM) {
    const pseudoHeader = causeM[2];
    if (V8_HEADER.test(pseudoHeader)) {
      const sub = parseV8Block([pseudoHeader, ...lines.slice(i + 1)], 0, atIndent ?? 0);
      trace.chained = { relation: "cause", trace: sub.trace };
      causeRawFrames = [...sub.trace.frames].reverse(); // back to crash-first
      i = i + sub.next;
    }
  }

  // Node elides outer frames that match the cause's stack tail: reconstruct.
  const resolved: Frame[] = [];
  for (let k = 0; k < rawFrames.length; k++) {
    const f = rawFrames[k];
    if (!("__elide" in f)) {
      resolved.push(f);
      continue;
    }
    const after = rawFrames[k + 1];
    let filled = false;
    if (after && !("__elide" in after) && causeRawFrames) {
      const j = causeRawFrames.findIndex(
        (cf) =>
          cf.rawPath === after.rawPath && cf.line === after.line && cf.column === after.column,
      );
      if (j >= f.__elide) {
        resolved.push(...causeRawFrames.slice(j - f.__elide, j).map((cf) => ({ ...cf })));
        filled = true;
      }
    }
    if (!filled) {
      for (let n = 0; n < f.__elide; n++) {
        resolved.push({ rawPath: "<elided>", line: null, isExternal: true });
      }
    }
  }
  trace.frames = resolved.reverse(); // normalize root-call → crash

  return { trace, next: i };
}

function parseAtLine(rest: string): Frame {
  // rest = everything after "at ", e.g.:
  //   "LedgerStore.append (/path/x.cjs:8:25)"   "async main (file:///x.mjs:11:3)"
  //   "/path/x.js:46:74"                        "Array.forEach (<anonymous>)"
  //   "new Foo (/p:1:2)"                        "async /p/nest-factory.js:111:17"
  const parenM = rest.match(/^(.*?) \(([^)]*)\)/);
  if (parenM) {
    const symbol = parenM[1];
    const loc = parseLoc(parenM[2]);
    const f: Frame = {
      rawPath: loc.path,
      line: loc.line,
      isExternal: isExternalJsPath(loc.path),
    };
    if (loc.column !== null) f.column = loc.column;
    if (symbol) f.symbol = symbol;
    return f;
  }
  // bare form: optional "async " / "new " prefix then path:line:col
  const bareM = rest.match(/^((?:async|new)\s+)?(.+?):(\d+):(\d+)\s*$/);
  if (bareM) {
    const f: Frame = {
      rawPath: bareM[2],
      line: Number(bareM[3]),
      column: Number(bareM[4]),
      isExternal: isExternalJsPath(bareM[2]),
    };
    if (bareM[1]) f.symbol = bareM[1].trim();
    return f;
  }
  return { rawPath: rest.trim(), line: null, isExternal: true, unparsed: true };
}

function parseLoc(loc: string): { path: string; line: number | null; column: number | null } {
  const m = loc.match(/^(.+?):(\d+):(\d+)$/);
  if (m) return { path: m[1], line: Number(m[2]), column: Number(m[3]) };
  return { path: loc || "<anonymous>", line: null, column: null };
}
