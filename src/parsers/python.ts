// Python traceback parser (plan.md §5.2). Ported from the Phase 0 spike
// (spike/parse.mjs), which passed 31/32 of the real-trace corpus.
import { type Frame, type ParsedTrace, isExternalPythonPath } from "./types.js";

export const PY_ANCHOR = /^(\s*)(?:\+ Exception Group )?Traceback \(most recent call last\):$/;
const PY_FRAME = /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?\s*$/;
const PY_REPEATED = /^\s*\[Previous line repeated (\d+) more times\]$/;
const PY_ANCHOR_DECORATION = /^\s*[~^\s]+$/;
const PY_EXC_LINE =
  /^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Exit|Interrupt|Iteration|GroupError|Group)?):?\s?(.*)$/;
const PY_CHAIN_CAUSE = /^The above exception was the direct cause of the following exception:$/;
const PY_CHAIN_CONTEXT = /^During handling of the above exception, another exception occurred:$/;

export function isGroupAnchor(line: string): boolean {
  return /^\s*\+ Exception Group Traceback \(most recent call last\):$/.test(line);
}

interface BlockResult {
  trace: ParsedTrace;
  next: number;
}

export function parsePythonChain(lines: string[], start: number): BlockResult {
  // Consecutive blocks joined by chain separators. Printed order is
  // oldest-first; the surfaced exception is the LAST block. relationToPrev on
  // block k describes how block k-1 relates to it (cause | context).
  const blocks: { trace: ParsedTrace; relationToPrev: "cause" | "context" | null }[] = [];
  let i = start;
  let relation: "cause" | "context" | null = null;
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
    const rel = blocks[k].relationToPrev;
    if (rel) t.chained = { relation: rel, trace: current };
    current = t;
  }
  return { trace: current, next: i };
}

function peekChainSeparator(
  lines: string[],
  from: number,
): { relation: "cause" | "context"; anchorIdx: number } | null {
  let j = from;
  while (j < lines.length && lines[j].trim() === "") j++;
  let relation: "cause" | "context" | null = null;
  if (j < lines.length && PY_CHAIN_CAUSE.test(lines[j].trim())) relation = "cause";
  if (j < lines.length && PY_CHAIN_CONTEXT.test(lines[j].trim())) relation = "context";
  if (!relation) return null;
  j++;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (j < lines.length && (PY_ANCHOR.test(lines[j]) || isGroupAnchor(lines[j]))) {
    return { relation, anchorIdx: j };
  }
  return null;
}

function parsePythonBlock(lines: string[], start: number): BlockResult {
  const isGroup = isGroupAnchor(lines[start]);
  let i = start + 1;
  const frames: Frame[] = [];
  const strip = (l: string) => (isGroup ? l.replace(/^\s*\|\s?/, "") : l);

  while (i < lines.length) {
    const line = strip(lines[i]);
    const frameM = line.match(PY_FRAME);
    if (frameM) {
      const f: Frame = {
        rawPath: frameM[1],
        line: Number(frameM[2]),
        isExternal: isExternalPythonPath(frameM[1]),
      };
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
        // SyntaxError-family blocks end with a `File "…", line N` block that is
        // the error LOCATION, not a call frame — pop it off the frame list.
        const trace: ParsedTrace = { exception: { type, message }, frames };
        if (/(?:^|\.)(?:SyntaxError|IndentationError|TabError)$/.test(type)) {
          const last = frames[frames.length - 1];
          if (last && last.symbol === undefined) {
            frames.pop();
            trace.location = { rawPath: last.rawPath, line: last.line };
          }
        }
        return { trace, next: i };
      }
    }
    i++;
    if (i - start > 10000) break; // safety valve on adversarial input
  }
  return {
    trace: { exception: { type: "Unknown", message: "" }, frames },
    next: i,
  };
}
