import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRepoIndex, matchPath, type RepoIndex } from "../src/resolve/repo.js";

let root: string;
let index: RepoIndex;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-repo-"));
  for (const rel of [
    "app/main.py",
    "app/routers/media.py",
    "lib/media.py",
    "app/a/util.py",
    "app/b/util.py",
  ]) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "# stub\n");
  }
  // noise that must be excluded from the index
  fs.mkdirSync(path.join(root, "node_modules/x"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules/x/media.py"), "# ignored\n");
  index = buildRepoIndex(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("repo index (§5.5)", () => {
  it("indexes files and skips node_modules", () => {
    expect(index.files.sort()).toEqual([
      "app/a/util.py",
      "app/b/util.py",
      "app/main.py",
      "app/routers/media.py",
      "lib/media.py",
    ]);
  });
});

describe("longest-suffix path matching (§5.5)", () => {
  it("matches an absolute prod path by longest suffix", () => {
    expect(matchPath(index, "/prod/box7/app/routers/media.py")).toEqual({
      file: "app/routers/media.py",
      ambiguous: false,
    });
  });

  it("resolves a bare basename via the fewest-hops tie-break (spec §5.5), not ambiguous", () => {
    expect(matchPath(index, "media.py")).toEqual({ file: "lib/media.py", ambiguous: false });
  });

  it("flags a same-depth suffix tie as ambiguous and picks deterministically", () => {
    expect(matchPath(index, "util.py")).toEqual({ file: "app/a/util.py", ambiguous: true });
  });

  it("prefers the shallower file on a suffix tie", () => {
    const m = matchPath(index, "somewhere/lib/media.py");
    expect(m).toEqual({ file: "lib/media.py", ambiguous: false });
  });

  it("returns null for paths not in the repo", () => {
    expect(matchPath(index, "/usr/lib/python3.13/json/decoder.py").file).toBeNull();
  });

  it("strips file:// scheme", () => {
    expect(matchPath(index, "file:///srv/app/main.py").file).toBe("app/main.py");
  });

  it("normalizes windows separators", () => {
    expect(matchPath(index, "C:\\srv\\app\\main.py").file).toBe("app/main.py");
  });
});
