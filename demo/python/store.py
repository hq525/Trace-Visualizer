CATALOG = {
    "sku-1": {"name": "Mechanical Keyboard", "cents": 12900, "kind": "physical"},
    "sku-2": {"name": "Trackball", "cents": 8900, "kind": "physical"},
}


def get_product(sku):
    return CATALOG[sku]
