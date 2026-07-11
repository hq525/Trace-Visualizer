import golden_hook  # noqa: F401

import importlib


def load_plugin(name):
    return importlib.import_module(name)


if __name__ == "__main__":
    load_plugin("boom_on_import")
