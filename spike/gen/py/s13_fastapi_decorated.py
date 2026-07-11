import golden_hook  # noqa: F401

from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()


@app.get("/portfolio/{book}")
def read_portfolio(book: str):
    books = {"main": {"nav": 1_204_330.55}}
    return books[book]


if __name__ == "__main__":
    TestClient(app).get("/portfolio/intraday")
