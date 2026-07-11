"use strict";
const express = require("express");

const app = express();

app.get("/invoices/:id", (req, res) => {
  const invoices = { "inv-1": { total: 100.5 } };
  const invoice = invoices[req.params.id];
  res.json({ total: invoice.total.toFixed(2) });
});

if (process.env.GOLDEN_OUT && globalThis.__dumpGolden) {
  // golden mode only: intercept the error express would otherwise log
  app.use((err, _req, _res, _next) => {
    globalThis.__dumpGolden(err);
  });
}

const server = app.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  try {
    await fetch(`http://127.0.0.1:${port}/invoices/inv-404`);
  } catch {
    // response itself succeeds with a 500; nothing to do
  }
  setTimeout(() => process.exit(0), 400);
});
