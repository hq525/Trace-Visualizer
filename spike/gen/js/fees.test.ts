import { expect, test } from "vitest";

function applyProcessingFee(amountCents: number): number {
  return amountCents - 30;
}

test("processing fee never makes the charge negative", () => {
  const charged = applyProcessingFee(10);
  expect(charged).toBeGreaterThanOrEqual(0);
});
