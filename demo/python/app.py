from fastapi import FastAPI
from services import price_with_tax

app = FastAPI(title="crashpath demo shop")


@app.get("/products/{sku}")
def read_product(sku: str):
    return price_with_tax(sku)
