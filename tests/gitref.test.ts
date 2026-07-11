import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRef } from "../src/gitref/index.js";
import { runPipeline } from "../src/pipeline.js";

const V1 = `def charge(cents):
    fees = {}
    return cents + fees["standard"]
`;

// HEAD moves charge() down and renames things — v1 line numbers no longer match
const V2 = `# billing module, reworked
# more header noise to shift lines


def refund(cents):
    return -cents


def charge(cents):
    fees = {}
    return cents + fees["standard"]
`;

// recorded against v1: crash at line 3 inside charge
const TRACE = `Traceback (most recent call last):
  File "/srv/pay/billing.py", line 3, in charge
    return cents + fees["standard"]
KeyError: 'standard'
`;

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-ref-"));
  const git = (cmd: string) =>
    execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: root });
  fs.writeFileSync(path.join(root, "billing.py"), V1);
  git("init -q");
  git("add .");
  git("commit -qm v1");
  git("tag v1");
  fs.writeFileSync(path.join(root, "billing.py"), V2);
  git("add .");
  git("commit -qm v2");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("--ref (§5.10)", () => {
  it("resolves cleanly against the tagged worktree and cleans up after itself", async () => {
    let worktreePath = "";
    const graph = await withRef(root, "v1", async (worktreeRoot) => {
      worktreePath = worktreeRoot;
      expect(fs.existsSync(path.join(worktreeRoot, "billing.py"))).toBe(true);
      const result = await runPipeline(TRACE, worktreeRoot);
      if (!result.ok) throw new Error(result.message);
      return result.graph;
    });
    const crash = graph.nodes.find((n) => n.crash);
    expect(crash?.name).toBe("charge");
    expect(crash?.badges).toEqual([]); // v1 lines match: no drift badge
    expect(fs.existsSync(worktreePath)).toBe(false); // worktree removed
  });

  it("shows drift against HEAD without --ref (the problem --ref solves)", async () => {
    const result = await runPipeline(TRACE, root);
    if (!result.ok) throw new Error(result.message);
    const crash = result.graph.nodes.find((n) => n.crash);
    expect(crash?.badges).toContain("line-name-mismatch");
  });

  it("rejects unknown refs with a clear error", async () => {
    await expect(withRef(root, "no-such-tag", async () => "x")).rejects.toThrow(/no-such-tag/);
  });
});
