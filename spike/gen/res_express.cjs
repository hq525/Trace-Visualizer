"use strict";
// Phase 0 throwaway: real stacks through the installed express/router sources.
// Usage: node res_express.cjs <outdir>   (run from the jsapp staging dir)
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OUT = path.resolve(process.argv[2]);
fs.mkdirSync(OUT, { recursive: true });

const scenarios = {
  "express-route-typeerror.txt": `
const express = require("express");
const app = express();
app.get("/invoices/:id", (req, res) => {
  const invoices = { "inv-1": { total: 100.5 } };
  res.json({ total: invoices[req.params.id].total.toFixed(2) });
});
const server = app.listen(0, "127.0.0.1", async () => {
  await fetch("http://127.0.0.1:" + server.address().port + "/invoices/nope").catch(() => {});
  setTimeout(() => process.exit(0), 300);
});
`,
  "express-middleware-error.txt": `
const express = require("express");
const app = express();
app.use((req, res, next) => {
  const session = undefined;
  req.userId = session.userId; // boom in middleware
  next();
});
app.get("/ok", (req, res) => res.send("ok"));
const server = app.listen(0, "127.0.0.1", async () => {
  await fetch("http://127.0.0.1:" + server.address().port + "/ok").catch(() => {});
  setTimeout(() => process.exit(0), 300);
});
`,
};

for (const [name, code] of Object.entries(scenarios)) {
  const file = path.join(process.cwd(), `_res_${name.replace(/\W/g, "_")}.cjs`);
  fs.writeFileSync(file, code);
  const r = spawnSync("node", [file], { encoding: "utf8", timeout: 30_000 });
  fs.writeFileSync(path.join(OUT, name), r.stderr);
  fs.unlinkSync(file);
  console.log(`  wrote ${name} (${r.stderr.split("\n").length} lines)`);
}
