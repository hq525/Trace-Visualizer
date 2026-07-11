import { type ChildProcess, execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let child: ChildProcess;
let url: string;

function spawnDemo(flavor: string): ChildProcess {
  return spawn(
    process.execPath,
    [path.join(ROOT, "dist/cli/index.js"), "demo", flavor, "--no-open"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function waitForUrl(proc: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("demo server did not start")), 10_000);
    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = buffer.match(/crashpath: (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
}

test.beforeAll(async () => {
  execSync("npx tsc -p tsconfig.json", { cwd: ROOT, stdio: "pipe" });
  child = spawnDemo("python");
  url = await waitForUrl(child);
});

test.afterAll(() => {
  child.kill();
});

test("demo renders the spine, legend, and code panel", async ({ page }) => {
  await page.goto(url);

  // spine: 1 external chip + 5 resolved app functions
  await expect(page.locator("[data-node]")).toHaveCount(6);
  await expect(page.locator('[data-node][data-kind="external-chip"]')).toHaveCount(1);

  // legend is always visible
  await expect(page.getByText("runtime trace")).toBeVisible();

  // crash node is selected on load; the panel shows the crash line
  await expect(page.locator("[data-panel]")).toContainText("fx.py:9");
  await expect(page.locator("[data-snippet]")).toContainText("return RATES[currency]");

  // clicking another node swaps the panel
  await page.locator('[data-node][data-kind="function"]').first().click();
  await expect(page.locator("[data-panel]")).toContainText("app.py");

  // keyboard: ← walks the spine
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-panel]")).toContainText("collapsed frames");
});

test("demo node maps minified frames back to TS sources", async ({ page }) => {
  const nodeChild = spawnDemo("node");
  try {
    const nodeUrl = await waitForUrl(nodeChild);
    await page.goto(nodeUrl);

    // crash node pre-selected: original TS file, sourcemap badge, real source
    await expect(page.locator("[data-panel]")).toContainText("pricing.ts");
    await expect(page.locator("[data-panel]")).toContainText("via-sourcemap");
    await expect(page.locator("[data-snippet]")).toContainText("RangeError");
  } finally {
    nodeChild.kill();
  }
});
