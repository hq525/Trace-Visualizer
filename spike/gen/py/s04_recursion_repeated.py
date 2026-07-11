import golden_hook  # noqa: F401


def descend(node, depth):
    return descend(node, depth + 1)


if __name__ == "__main__":
    descend({"id": "root"}, 0)
