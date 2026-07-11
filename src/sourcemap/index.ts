// Sourcemap resolution (plan.md §5.3), JS/TS only. Runs between parse and
// resolve: frames that land in generated repo files (dist/, build/, .next/,
// or anything carrying a sourceMappingURL) are rewritten to their original
// source position. Failures never break the pipeline — the frame keeps its
// compiled position and gets a `no-sourcemap` marker instead.
import fs from "node:fs";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";
import type { Frame, ParsedTrace } from "../parsers/types.js";
import { type RepoIndex, listGeneratedFiles, matchPath } from "../resolve/repo.js";

const GENERATED_PATH = /(^|\/)(dist|build|\.next|out)\//;
const MAP_DIRECTIVE = /\/\/[#@] sourceMappingURL=([^\s]+)\s*$/m;

interface LoadedMap {
  consumer: SourceMapConsumer | null;
  /** repo-relative dir the map's `sources` entries are relative to */
  baseDir: string;
}

export async function applySourcemaps(trace: ParsedTrace, index: RepoIndex): Promise<ParsedTrace> {
  const cache = new Map<string, LoadedMap | null>();
  // generated dirs are excluded (and usually gitignored) from the main index;
  // frames in compiled bundles match against this dedicated one
  const generatedIndex: RepoIndex = { root: index.root, files: listGeneratedFiles(index.root) };
  for (let t: ParsedTrace | undefined = trace; t; t = t.chained?.trace) {
    for (const frame of t.frames) {
      rewriteFrame(frame, generatedIndex, cache);
    }
  }
  return trace;
}

function rewriteFrame(frame: Frame, index: RepoIndex, cache: Map<string, LoadedMap | null>): void {
  if (frame.isExternal || frame.line === null || frame.column === undefined) return;
  const match = matchPath(index, frame.rawPath);
  if (!match.file) return;

  const loaded = loadMapFor(match.file, index.root, cache);
  if (loaded === null) return; // not a generated file
  if (!loaded.consumer) {
    frame.noSourcemap = true;
    return;
  }

  const pos = loaded.consumer.originalPositionFor({
    line: frame.line,
    column: Math.max(0, frame.column - 1), // consumer columns are 0-based
  });
  if (!pos.source || pos.line == null) {
    frame.noSourcemap = true;
    return;
  }

  frame.mappedFrom = frame.rawPath;
  frame.rawPath = normalizeJoin(loaded.baseDir, pos.source);
  frame.line = pos.line;
  frame.column = pos.column != null ? pos.column + 1 : undefined;
  // The map's `name` is the identifier AT the position (often the thrown
  // constructor), not the enclosing function — and the minified symbol is
  // noise. Drop it: span resolution against the original source is exact.
  frame.symbol = undefined;
}

/** null = not generated; consumer null = generated but map missing/broken. */
function loadMapFor(
  repoFile: string,
  root: string,
  cache: Map<string, LoadedMap | null>,
): LoadedMap | null {
  const cached = cache.get(repoFile);
  if (cached !== undefined) return cached;

  const abs = path.join(root, repoFile);
  let content: string;
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    cache.set(repoFile, null);
    return null;
  }
  const directive = content.match(MAP_DIRECTIVE);
  if (!GENERATED_PATH.test(repoFile) && !directive) {
    cache.set(repoFile, null);
    return null;
  }

  const baseDir = path.posix.dirname(repoFile.split(path.sep).join("/"));
  let mapJson: string | null = null;
  if (directive?.[1].startsWith("data:")) {
    const b64 = directive[1].split("base64,")[1];
    mapJson = b64 ? Buffer.from(b64, "base64").toString("utf8") : null;
  } else {
    const mapRel = directive?.[1] ?? `${path.basename(repoFile)}.map`;
    try {
      mapJson = fs.readFileSync(path.resolve(path.dirname(abs), mapRel), "utf8");
    } catch {
      mapJson = null;
    }
  }

  let entry: LoadedMap;
  try {
    entry = mapJson
      ? { consumer: new SourceMapConsumer(JSON.parse(mapJson)), baseDir }
      : { consumer: null, baseDir };
  } catch {
    entry = { consumer: null, baseDir };
  }
  cache.set(repoFile, entry);
  return entry;
}

function normalizeJoin(baseDir: string, source: string): string {
  const joined = path.posix.normalize(path.posix.join(baseDir, source));
  return joined.startsWith("../") ? source : joined;
}
