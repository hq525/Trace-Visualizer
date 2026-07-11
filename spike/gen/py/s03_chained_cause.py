import golden_hook  # noqa: F401


class ConfigError(Exception):
    pass


def parse_port(raw):
    try:
        return int(raw)
    except ValueError as e:
        raise ConfigError(f"invalid port value: {raw!r}") from e


def boot():
    return parse_port("eight-thousand")


if __name__ == "__main__":
    boot()
