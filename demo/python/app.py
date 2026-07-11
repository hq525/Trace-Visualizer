from fastapi import FastAPI
from services import build_quote

app = FastAPI(title="crashpath demo shop")


@app.get("/products/{sku}")
def read_product(sku: str, currency: str = "USD"):
    return build_quote(sku, currency)
