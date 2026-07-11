export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
}

export function midPrice(quote: Quote): number {
  return (quote.bid + quote.ask) / 2;
}

export function spreadBps(quote: Quote): number {
  const mid = midPrice(quote);
  return ((quote.ask - quote.bid) / mid) * 10_000;
}

export function requireTightSpread(quote: Quote, maxBps: number): Quote {
  const bps = spreadBps(quote);
  if (bps > maxBps) {
    throw new RangeError(
      `spread ${bps.toFixed(1)}bps exceeds limit ${maxBps}bps for ${quote.symbol}`,
    );
  }
  return quote;
}
