from fastapi import FastAPI

app = FastAPI()


@app.get("/checkout/{cart_id}")
def checkout(cart_id: str):
    carts = {"c-100": {"total": 42.0}}
    cart = carts[cart_id]
    return {"charged": cart["total"]}
