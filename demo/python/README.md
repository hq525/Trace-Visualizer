# crashpath demo: shop

A deliberately buggy FastAPI mini-app. `GET /products/sku-404` raises
`KeyError: 'sku-404'` inside `store.get_product`.

`trace.txt` is a **pre-recorded** real traceback from running this app —
`crashpath demo python` never executes this code, it only maps the trace onto
these sources. Paths in the trace are sanitized to `/home/dev/shop/...`;
crashpath's longest-suffix matching resolves them against this directory.
