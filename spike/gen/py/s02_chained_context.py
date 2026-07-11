import golden_hook  # noqa: F401


def read_config():
    raise FileNotFoundError("config.toml not found")


def fallback_config():
    defaults = {"mode": "default"}
    return defaults["production"]


def start():
    try:
        return read_config()
    except FileNotFoundError:
        return fallback_config()


start()
