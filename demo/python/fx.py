RATES = {
    "USD": 1.0,
    "EUR": 0.92,
    "SGD": 1.34,
}


def _lookup_rate(currency):
    return RATES[currency]


def convert(cents, currency):
    return round(cents * _lookup_rate(currency))
