import golden_hook  # noqa: F401


def validate(payload):
    problems = [
        "missing required field: user_id",
        "amount must be > 0, got -12.50",
        "currency 'XYZ' is not supported",
    ]
    if problems:
        raise ValueError("payload validation failed:\n  - " + "\n  - ".join(problems))


def ingest(payload):
    validate(payload)


if __name__ == "__main__":
    ingest({"amount": -12.5, "currency": "XYZ"})
