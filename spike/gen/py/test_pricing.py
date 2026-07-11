from decimal import Decimal


def apply_processing_fee(amount):
    return amount - Decimal("0.30")


def test_fee_never_makes_amount_negative():
    charged = apply_processing_fee(Decimal("0.10"))
    assert charged >= 0, f"fee made amount negative: {charged}"
