import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTraces } from "../src/extract/index.js";

const DIR = fileURLToPath(new URL("../fixtures/traces", import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

describe("extraction from dirty input (§5.1)", () => {
  it("finds a python trace inside a JSON log line (\\n-escaped exc_info field)", () => {
    const traces = extractTraces(read("19-py-json-wrapped.txt"));
    expect(traces).toHaveLength(1);
    expect(traces[0].language).toBe("python");
    expect(traces[0].exception.type).toBe("AttributeError");
  });

  it("strips k8s CRI per-line prefixes", () => {
    const traces = extractTraces(read("20-py-k8s-prefixed.txt"));
    expect(traces).toHaveLength(1);
    expect(traces[0].language).toBe("python");
    expect(traces[0].chained?.relation).toBe("cause");
  });

  it("strips the NestJS log prefix that embeds the error header", () => {
    const traces = extractTraces(read("31-js-nestjs-prefixed.txt"));
    expect(traces).toHaveLength(1);
    expect(traces[0].language).toBe("js");
    expect(traces[0].frames).toHaveLength(10);
  });

  it("strips Azure per-line prefixes and ignores orphan at-lines before the header", () => {
    const traces = extractTraces(read("32-js-nextjs-azure.txt"));
    expect(traces).toHaveLength(1);
    expect(traces[0].frames).toHaveLength(7);
  });

  it("finds a python trace among celery log lines", () => {
    const traces = extractTraces(read("29-py-celery-workerlost.txt"));
    expect(traces).toHaveLength(1);
    expect(traces[0].exception.type).toBe("billiard.exceptions.WorkerLostError");
  });

  it("marks stdlib/site-packages/frozen frames external, app frames internal", () => {
    const traces = extractTraces(read("13-py-fastapi-decorated.txt"));
    const frames = traces[0].frames;
    expect(frames.some((f) => f.isExternal)).toBe(true);
    const crash = frames[frames.length - 1];
    expect(crash.isExternal).toBe(false);
    expect(crash.symbol).toBe("read_portfolio");
  });

  it("returns [] when there is nothing trace-shaped", () => {
    expect(extractTraces("just some\nregular log lines\nnothing here")).toEqual([]);
  });
});
