from fx import convert
from store import get_product

TAX_RATE = 0.09

PRICERS = {}


def pricer(kind):
    def register(fn):
        PRICERS[kind] = fn
        return fn

    return register


@pricer("physical")
def price_with_tax(product, currency):
    taxed_cents = round(product["cents"] * (1 + TAX_RATE))
    return convert(taxed_cents, currency)


def build_quote(sku, currency):
    product = get_product(sku)
    total_cents = PRICERS[product["kind"]](product, currency)
    return {"sku": sku, "name": product["name"], "currency": currency, "total_cents": total_cents}
