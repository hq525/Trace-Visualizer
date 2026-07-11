import golden_hook  # noqa: F401

import asyncio


async def fetch_quote(symbol):
    await asyncio.sleep(0)
    raise ConnectionResetError(f"feed dropped while fetching {symbol}")


async def refresh_symbol(symbol):
    try:
        return await fetch_quote(symbol)
    except ConnectionResetError as e:
        raise RuntimeError(f"quote refresh failed for {symbol}") from e


async def main():
    await refresh_symbol("TSLA")


if __name__ == "__main__":
    asyncio.run(main())
