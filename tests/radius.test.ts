import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TraceGraph } from "../src/graph/types.js";
import { runPipeline } from "../src/pipeline.js";

const PRICING = `def apply_discount(cents):
    return cents - 100


def compute_total(cents):
    discounted = apply_discount(cents)
    return discounted + tax_lookup_failure(discounted)


def tax_lookup_failure(cents):
    rates = {}
    return rates["sg"]
`;

const BILLING = `from pricing import compute_total


def invoice_total(cents):
    return compute_total(cents)
`;

const TRACE = `Traceback (most recent call last):
  File "/srv/app/pricing.py", line 6, in compute_total
    return discounted + tax_lookup_failure(discounted)
  File "/srv/app/pricing.py", line 11, in tax_lookup_failure
    return rates["sg"]
KeyError: 'sg'
`;

let root: string;
let graph: TraceGraph;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "crashpath-radius-"));
  fs.writeFileSync(path.join(root, "pricing.py"), PRICING);
  fs.writeFileSync(path.join(root, "billing.py"), BILLING);
  // caller search prefers `git grep`; make it a real repo
  execSync("git init -q && git add . && git -c user.email=t@t -c user.name=t commit -qm x", {
    cwd: root,
  });
  const result = await runPipeline(TRACE, root);
  if (!result.ok) throw new Error(result.message);
  graph = result.graph;
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("blast radius (§5.8)", () => {
  const byName = (name: string) => graph.nodes.find((n) => n.name === name);

  it("adds off-spine callees of spine functions at reduced standing", () => {
    const callee = byName("apply_discount");
    expect(callee).toBeDefined();
    expect(callee?.onSpine).toBe(false);
    const edge = graph.edges.find(
      (e) => e.kind === "call" && e.to === callee?.id && e.from === byName("compute_total")?.id,
    );
    expect(edge?.evidence).toBe("static");
  });

  it("finds callers via git grep and links them into the spine", () => {
    const caller = byName("invoice_total");
    expect(caller).toBeDefined();
    expect(caller?.onSpine).toBe(false);
    const edge = graph.edges.find(
      (e) => e.kind === "call" && e.from === caller?.id && e.to === byName("compute_total")?.id,
    );
    expect(edge).toBeDefined();
  });

  it("keeps the spine itself intact", () => {
    expect(byName("compute_total")?.onSpine).toBe(true);
    expect(byName("tax_lookup_failure")?.crash).toBe(true);
  });
});
