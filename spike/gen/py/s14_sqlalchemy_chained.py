import golden_hook  # noqa: F401

from sqlalchemy import create_engine, text


def fetch_open_orders(engine):
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, qty FROM orders WHERE status = 'open'"))
        return rows.fetchall()


if __name__ == "__main__":
    engine = create_engine("sqlite:///:memory:")
    fetch_open_orders(engine)
