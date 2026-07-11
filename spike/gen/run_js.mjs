#!/usr/bin/env node
// Phase 0 throwaway: run JS trace scenarios twice (text run = natural stderr,
// golden run = preloaded prepareStackTrace hook), sanitize, write fixtures.
// Usage: node spike/gen/run_js.mjs <staging_jsapp_dir>
import { execFileSync, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(REPO, "spike", "gen", "js");
const OUT = path.join(REPO, "fixtures", "traces");
const STAGING = path.resolve(process.argv[2]);

const REPLACEMENTS = [
  [STAGING, "/home/dev/app"],
  [STAGING.replace("/private/tmp", "/tmp"), "/home/dev/app"],
].sort((a, b) => b[0].length - a[0].length);

function sanitize(text) {
  for (const [real, fake] of REPLACEMENTS) text = text.replaceAll(real, fake);
  return text;
}

function writeFixture(name, rawText, goldenPath) {
  fs.writeFileSync(path.join(OUT, `${name}.txt`), sanitize(rawText));
  if (goldenPath && fs.existsSync(goldenPath)) {
    fs.writeFileSync(
      path.join(OUT, `${name}.golden.json`),
      sanitize(fs.readFileSync(goldenPath, "utf8")),
    );
    fs.unlinkSync(goldenPath);
  }
  console.log(`  wrote ${name}.txt`);
}

function runScenario(name, script, { goldenRun = true } = {}) {
  const golden = path.join(STAGING, "golden.json");
  if (fs.existsSync(golden)) fs.unlinkSync(golden);

  // text run: natural node output
  const text = spawnSync("node", [script], { cwd: STAGING, encoding: "utf8", timeout: 60_000 });
  // golden run: structured CallSites via preload
  if (goldenRun) {
    spawnSync("node", ["--require", "./golden_hook.cjs", script], {
      cwd: STAGING,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, GOLDEN_OUT: golden },
    });
  }
  writeFixture(name, text.stderr, goldenRun ? golden : null);
}

fs.mkdirSync(OUT, { recursive: true });
// copy scenarios + hook into staging (paths in traces must be the staging paths)
for (const f of fs.readdirSync(SRC)) {
  const src = path.join(SRC, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(STAGING, f));
}
fs.mkdirSync(path.join(STAGING, "src"), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, "src"))) {
  fs.copyFileSync(path.join(SRC, "src", f), path.join(STAGING, "src", f));
}

runScenario("21-js-typeerror-deep-cjs", "s21_typeerror_deep.cjs");
runScenario("22-js-esm-file-urls", "s22_esm_file_urls.mjs");
runScenario("23-js-async-await", "s23_async_await.mjs");
runScenario("24-js-cause-chain", "s24_cause_chain.mjs");
runScenario("25-js-express-route", "s25_express_route.cjs");

// 26: vitest failing test (vitest owns the framing; golden hand-audited later)
const vitest = spawnSync("npx", ["vitest", "run", "fees.test.ts"], {
  cwd: STAGING,
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
});
writeFixture("26-js-vitest-fail", vitest.stdout + vitest.stderr, null);

// 27: minified bundle + sourcemap
execSync(
  "npx esbuild src/app.ts --bundle --minify --sourcemap --platform=node --outfile=dist/bundle.js",
  { cwd: STAGING, stdio: "pipe" },
);
runScenario("27-js-minified-sourcemap", "dist/bundle.js");
// keep the sourcemap + original sources next to the fixture for Phase 2
fs.copyFileSync(
  path.join(STAGING, "dist", "bundle.js.map"),
  path.join(OUT, "27-js-minified-sourcemap.bundle.js.map"),
);
fs.copyFileSync(
  path.join(STAGING, "dist", "bundle.js"),
  path.join(OUT, "27-js-minified-sourcemap.bundle.js"),
);

// 28: winston-style JSON log lines wrapping 23's stack (from sanitized fixture)
const trace23 = fs.readFileSync(path.join(OUT, "23-js-async-await.txt"), "utf8");
const stackOnly = trace23.split("\n").filter((l) => !l.startsWith("Node.js v")).join("\n").trim();
const winston = [
  JSON.stringify({ level: "info", message: "deploy started", service: "release-bot", timestamp: "2026-07-11T04:01:02.001Z" }),
  JSON.stringify({ level: "error", message: "deploy failed", service: "release-bot", timestamp: "2026-07-11T04:01:03.412Z", stack: stackOnly }),
  JSON.stringify({ level: "info", message: "rollback complete", service: "release-bot", timestamp: "2026-07-11T04:01:05.230Z" }),
].join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "28-js-winston-json.txt"), winston);
fs.copyFileSync(
  path.join(OUT, "23-js-async-await.golden.json"),
  path.join(OUT, "28-js-winston-json.golden.json"),
);
console.log("  wrote 28-js-winston-json.txt");
console.log("JS CORPUS DONE");
