CATALOG = {
    "sku-1": {"name": "Mechanical Keyboard", "cents": 12900},
    "sku-2": {"name": "Trackball", "cents": 8900},
}


def get_product(sku):
    return CATALOG[sku]
