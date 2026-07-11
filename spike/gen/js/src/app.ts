import { requireTightSpread, type Quote } from "./pricing";

function loadQuotes(): Quote[] {
  return [
    { symbol: "AAPL", bid: 227.1, ask: 227.12 },
    { symbol: "ILLIQ", bid: 4.1, ask: 5.9 },
  ];
}

function screenUniverse(maxBps: number): Quote[] {
  return loadQuotes().map((q) => requireTightSpread(q, maxBps));
}

screenUniverse(50);
