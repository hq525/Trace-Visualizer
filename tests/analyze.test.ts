import { describe, expect, it } from "vitest";
import { analyzePythonSource } from "../src/analyze/python.js";

const SOURCE = `from fastapi import FastAPI
app = FastAPI()

class OrderStore:
    def get(self, oid):
        return self._rows[oid]

@app.get("/orders/{oid}")
def read_order(oid: str):
    store = OrderStore()
    return store.get(oid)
`;

describe("python tree-sitter analysis (§5.4)", () => {
  it("extracts symbols with spans, qualified names and decorators", async () => {
    const a = await analyzePythonSource("shop/api.py", SOURCE);

    const cls = a.symbols.find((s) => s.qualifiedName === "OrderStore");
    expect(cls).toMatchObject({ kind: "class", span: [4, 6] });

    const method = a.symbols.find((s) => s.qualifiedName === "OrderStore.get");
    expect(method).toMatchObject({ name: "get", kind: "function", span: [5, 6] });

    const route = a.symbols.find((s) => s.qualifiedName === "read_order");
    expect(route).toMatchObject({ kind: "function" });
    expect(route?.decorators).toEqual(["app.get"]);
    expect(route?.span[0]).toBeLessThanOrEqual(9);
    expect(route?.span[1]).toBe(11);
  });

  it("extracts imports", async () => {
    const a = await analyzePythonSource("shop/api.py", SOURCE);
    expect(a.imports).toContainEqual({ module: "fastapi", names: ["FastAPI"], line: 1 });
  });

  it("extracts call sites with enclosing function", async () => {
    const a = await analyzePythonSource("shop/api.py", SOURCE);
    expect(a.calls).toContainEqual({ calleeName: "get", line: 11, enclosing: "read_order" });
    expect(a.calls).toContainEqual({
      calleeName: "OrderStore",
      line: 10,
      enclosing: "read_order",
    });
  });

  it("reports line count", async () => {
    const a = await analyzePythonSource("shop/api.py", SOURCE);
    expect(a.lineCount).toBeGreaterThanOrEqual(11);
  });
});
