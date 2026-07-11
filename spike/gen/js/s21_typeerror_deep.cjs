"use strict";

class LedgerStore {
  constructor() {
    this.entries = null;
  }
  append(entry) {
    return this.entries.push(entry);
  }
}

const audit = {
  record(entry, store) {
    return store.append(entry);
  },
};

function settleTrade(trade, store) {
  return audit.record({ id: trade.id, qty: trade.qty }, store);
}

function main() {
  const store = new LedgerStore();
  return settleTrade({ id: "T-1042", qty: 250 }, store);
}

main();
