import golden_hook  # noqa: F401

import requests


def get_prices(base_url):
    resp = requests.get(f"{base_url}/v1/prices?symbols=AAPL,MSFT", timeout=2)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    get_prices("http://127.0.0.1:9")
