# crashpath demo: shop

A deliberately buggy FastAPI mini-app. `GET /products/sku-1?currency=USD%20`
(note the trailing space — a classic unsanitized-query bug) raises
`KeyError: 'USD '` five frames deep, inside `fx._lookup_rate`.

`trace.txt` is a **pre-recorded** real traceback from running this app —
`crashpath demo python` never executes this code, it only maps the trace onto
these sources. Paths in the trace are sanitized to `/home/dev/shop/...`;
crashpath's longest-suffix matching resolves them against this directory.
