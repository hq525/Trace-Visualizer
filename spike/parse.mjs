// Phase 0 throwaway: dirty text -> ParsedTrace[]. Validates plan §5.1 (extract)
// and §5.2 (python + v8 frame parsers). Not production code.

// ---------- stage 1: line cleanup (log prefixes, JSON-wrapped lines) ----------

const PREFIX_PATTERNS = [
  // k8s CRI: 2026-07-11T03:25:44.118437221Z stderr F <line>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z (?:stdout|stderr) [PF] /,
  // ISO timestamp + [LEVEL]: Azure/app-service style `2023-...Z: [ERROR] <line>`
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?:? \[(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\] /i,
  // NestJS: `[Nest] 42467  - 02/28/2026, 1:16:04 PM   ERROR [ExceptionHandler] <line>`
  /^\[Nest\] \d+\s+-\s+[\d/]+,? [\d:]+ (?:AM|PM)?\s*(?:ERROR|WARN|LOG|DEBUG|VERBOSE|FATAL)\s+(?:\[\w+\] )?/,
];

const TRACE_HINT = /Traceback \(most recent call last\)|(?:^|\n)\s*at .+(?::\d+:\d+|\(<anonymous>\)|\(native\))/;

function stripPrefixes(line) {
  for (const re of PREFIX_PATTERNS) {
    const m = line.match(re);
    if (m) return line.slice(m[0].length);
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
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
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
        if (found) continue;
      }
    }
    out.push(line);
  }
  return out;
}

function* walkStrings(obj, depth = 0) {
  if (depth > 3 || obj == null) return;
  for (const v of Object.values(obj)) {
    if (typeof v === "string") yield v;
    else if (typeof v === "object") yield* walkStrings(v, depth + 1);
  }
}

// ---------- stage 2: block detection + parsing ----------

const PY_ANCHOR = /^(\s*)(?:\+ Exception Group )?Traceback \(most recent call last\):$/;
const PY_FRAME = /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?\s*$/;
const PY_REPEATED = /^\s*\[Previous line repeated (\d+) more times\]$/;
const PY_ANCHOR_DECORATION = /^\s*[~^\s]+$/;
const PY_EXC_LINE = /^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Exit|Interrupt|Iteration|GroupError|Group)?):?\s?(.*)$/;
const PY_CHAIN_CAUSE = /^The above exception was the direct cause of the following exception:$/;
const PY_CHAIN_CONTEXT = /^During handling of the above exception, another exception occurred:$/;

const V8_HEADER = /^(?:Uncaught )?([A-Za-z_$][\w$]*(?:Error|Exception)(?:\s\[[A-Z_]+\])?|AssertionError|Error): (.*)$/;
const V8_AT = /^(\s*)(?:at|❯)\s+(.+)$/; // ❯ = vitest's frame marker
const V8_ELISION = /^\s*\.\.\. (\d+) lines matching cause stack trace \.\.\.$/;

export function extractTraces(text) {
  const lines = cleanInput(text);
  const traces = [];
  let i = 0;
  while (i < lines.length) {
    if (PY_ANCHOR.test(lines[i]) || isGroupAnchor(lines[i])) {
      const r = parsePythonChain(lines, i);
      traces.push({ language: "python", ...r.trace });
      i = r.next;
    } else if (V8_HEADER.test(lines[i]) && V8_AT.test(lines[i + 1] ?? "")) {
      const r = parseV8Block(lines, i);
      traces.push({ language: "js", ...r.trace });
      i = r.next;
    } else {
      i++;
    }
  }
  return traces;
}

function isGroupAnchor(line) {
  return /^\s*\+ Exception Group Traceback \(most recent call last\):$/.test(line);
}

// --- python ---

function parsePythonChain(lines, start) {
  // Collect consecutive blocks joined by chain separators. Printed order is
  // oldest-first; the surfaced exception is the LAST block. relationToPrev on
  // block k describes how block k-1 relates to it (cause | context).
  const blocks = [];
  let i = start;
  let relation = null;
  for (;;) {
    const r = parsePythonBlock(lines, i);
    blocks.push({ trace: r.trace, relationToPrev: relation });
    i = r.next;
    const sep = peekChainSeparator(lines, i);
    if (!sep) break;
    relation = sep.relation;
    i = sep.anchorIdx;
  }
  // link backward: newest block is top-level, chained points at the older one
  let current = blocks[0].trace;
  for (let k = 1; k < blocks.length; k++) {
    const t = blocks[k].trace;
    t.chained = { relation: blocks[k].relationToPrev, trace: current };
    current = t;
  }
  return { trace: current, next: i };
}

function peekChainSeparator(lines, i) {
  let j = i;
  while (j < lines.length && lines[j].trim() === "") j++;
  let relation = null;
  if (j < lines.length && PY_CHAIN_CAUSE.test(lines[j].trim())) relation = "cause";
  if (j < lines.length && PY_CHAIN_CONTEXT.test(lines[j].trim())) relation = "context";
  if (!relation) return null;
  j++;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (j < lines.length && (PY_ANCHOR.test(lines[j]) || isGroupAnchor(lines[j]))) {
    return { relation, anchorIdx: j, next: j };
  }
  return null;
}

function parsePythonBlock(lines, start) {
  const isGroup = isGroupAnchor(lines[start]);
  let i = start + 1;
  const frames = [];
  const strip = (l) => (isGroup ? l.replace(/^\s*\|\s?/, "") : l);

  while (i < lines.length) {
    const line = strip(lines[i]);
    const frameM = line.match(PY_FRAME);
    if (frameM) {
      const f = { rawPath: frameM[1], line: Number(frameM[2]) };
      if (frameM[3] !== undefined) f.symbol = frameM[3].trim();
      frames.push(f);
      i++;
      // consume source line / anchor decorations under the frame
      while (i < lines.length) {
        const sub = strip(lines[i]);
        const isFrame = PY_FRAME.test(sub);
        const isRepeat = PY_REPEATED.test(sub);
        const isDecoration = sub.trim() !== "" && PY_ANCHOR_DECORATION.test(sub);
        const isIndented = /^\s{3,}/.test(sub) && sub.trim() !== "";
        if (isFrame || isRepeat) break;
        if (isDecoration || isIndented) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    const repM = line.match(PY_REPEATED);
    if (repM) {
      if (frames.length) frames[frames.length - 1].repeated = Number(repM[1]);
      i++;
      continue;
    }
    // SyntaxError location block: File "...", line N (no `, in`) already matched
    // by PY_FRAME (group 3 optional); caret/source lines skipped above.
    // Exception line: non-indented (after margin strip) with Type[: message]
    if (line.trim() !== "" && !/^\s/.test(line)) {
      const excM = line.match(PY_EXC_LINE);
      if (excM) {
        const type = excM[1];
        let message = excM[2] ?? "";
        i++;
        // multiline message: consume only INDENTED continuation lines until
        // blank line, chain separator, new anchor, or group divider
        while (i < lines.length) {
          const cont = strip(lines[i]);
          const t = cont.trim();
          if (
            t === "" ||
            !/^\s/.test(cont) ||
            PY_CHAIN_CAUSE.test(t) ||
            PY_CHAIN_CONTEXT.test(t) ||
            PY_ANCHOR.test(cont) ||
            isGroupAnchor(cont) ||
            /^\+-+/.test(t) ||
            PY_FRAME.test(cont)
          ) {
            break;
          }
          message += `\n${cont}`;
          i++;
        }
        // SyntaxError-family blocks end with a `File "...", line N` block that
        // is the error LOCATION, not a call frame — pop it off the frame list.
        const trace = { exception: { type, message }, frames };
        if (/(?:^|\.)(?:SyntaxError|IndentationError|TabError)$/.test(type)) {
          const last = frames[frames.length - 1];
          if (last && last.symbol === undefined) {
            frames.pop();
            trace.location = last;
          }
        }
        return { trace, next: i, relationToPrev: null };
      }
    }
    i++;
    if (i - start > 10000) break; // safety
  }
  return {
    trace: { exception: { type: "Unknown", message: "" }, frames },
    next: i,
    relationToPrev: null,
  };
}

// --- v8 ---

function parseV8Block(lines, start, baseIndent = -1) {
  const headM = lines[start].match(V8_HEADER);
  const type = headM[1];
  let message = headM[2];
  let i = start + 1;
  const rawFrames = [];
  let atIndent = null;

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

  const trace = { exception: { type, message } };

  // [cause]: block (Node >=16.9)
  const causeM = (lines[i] ?? "").match(/^(\s*)\[cause\]: (.+)$/);
  let causeRawFrames = null;
  if (causeM) {
    const pseudoHeader = causeM[2];
    const hm = pseudoHeader.match(V8_HEADER);
    if (hm) {
      const sub = parseV8Block(
        [pseudoHeader, ...lines.slice(i + 1)],
        0,
        atIndent ?? 0,
      );
      trace.chained = { relation: "cause", trace: sub.trace };
      causeRawFrames = [...sub.trace.frames].reverse(); // back to crash-first
      i = i + sub.next;
    }
  }

  // Node elides outer frames that match the cause's stack tail
  // ("... N lines matching cause stack trace ..."): reconstruct from the cause.
  const resolved = [];
  for (let k = 0; k < rawFrames.length; k++) {
    const f = rawFrames[k];
    if (f.__elide == null) {
      resolved.push(f);
      continue;
    }
    const after = rawFrames[k + 1];
    let filled = false;
    if (after && causeRawFrames) {
      const j = causeRawFrames.findIndex(
        (cf) => cf.rawPath === after.rawPath && cf.line === after.line && cf.column === after.column,
      );
      if (j >= f.__elide) {
        resolved.push(...causeRawFrames.slice(j - f.__elide, j).map((cf) => ({ ...cf })));
        filled = true;
      }
    }
    if (!filled) {
      for (let n = 0; n < f.__elide; n++) resolved.push({ rawPath: "<elided>", line: null, column: null });
    }
  }
  trace.frames = resolved.reverse(); // normalize root-call -> crash

  return { trace, next: i };
}

function parseAtLine(rest) {
  // rest = everything after "at ", e.g.:
  //   "LedgerStore.append (/path/x.cjs:8:25)"   "async main (file:///x.mjs:11:3)"
  //   "/path/x.js:46:74"                        "Array.forEach (<anonymous>)"
  //   "new Foo (/p:1:2)"                        "async /p/nest-factory.js:111:17"
  const parenM = rest.match(/^(.*?) \(([^)]*)\)/);
  if (parenM) {
    const symbol = parenM[1];
    const loc = parseLoc(parenM[2]);
    const f = { rawPath: loc.path, line: loc.line, column: loc.column };
    if (symbol) f.symbol = symbol;
    return f;
  }
  // bare form: optional "async " prefix then path:line:col
  const bareM = rest.match(/^((?:async|new)\s+)?(.+?):(\d+):(\d+)\s*$/);
  if (bareM) {
    const f = {
      rawPath: bareM[2],
      line: Number(bareM[3]),
      column: Number(bareM[4]),
    };
    if (bareM[1]) f.symbol = bareM[1].trim();
    return f;
  }
  return { rawPath: rest.trim(), line: null, column: null, unparsed: true };
}

function parseLoc(loc) {
  const m = loc.match(/^(.+?):(\d+):(\d+)$/);
  if (m) return { path: m[1], line: Number(m[2]), column: Number(m[3]) };
  return { path: loc || "<anonymous>", line: null, column: null };
}
