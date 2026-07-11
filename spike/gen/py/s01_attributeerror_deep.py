import golden_hook  # noqa: F401


class Portfolio:
    def __init__(self):
        self.positions = {"AAPL": 10, "MSFT": 4}
        self.broker = None


def load_portfolio():
    return Portfolio()


def compute_weights(p):
    total = sum(p.positions.values())
    return {k: v / total for k, v in p.positions.items()}


def rebalance(p):
    weights = compute_weights(p)
    return p.broker.submit(weights)


def run_daily_job():
    p = load_portfolio()
    return rebalance(p)


if __name__ == "__main__":
    run_daily_job()
