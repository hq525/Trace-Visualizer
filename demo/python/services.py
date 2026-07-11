from store import get_product

TAX_RATE = 0.09


def price_with_tax(sku):
    product = get_product(sku)
    total_cents = round(product["cents"] * (1 + TAX_RATE))
    return {"sku": sku, "name": product["name"], "total_cents": total_cents}
