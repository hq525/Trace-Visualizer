from fx import convert
from store import get_product

TAX_RATE = 0.09


def price_with_tax(product, currency):
    taxed_cents = round(product["cents"] * (1 + TAX_RATE))
    return convert(taxed_cents, currency)


def build_quote(sku, currency):
    product = get_product(sku)
    total_cents = price_with_tax(product, currency)
    return {"sku": sku, "name": product["name"], "currency": currency, "total_cents": total_cents}
