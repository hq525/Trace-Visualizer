import golden_hook  # noqa: F401


def sync_shard_0():
    raise ValueError("bad tick value in shard 0")


def sync_shard_1():
    raise TimeoutError("shard 1 timed out after 30s")


def sync_all_shards():
    errors = []
    for task in (sync_shard_0, sync_shard_1):
        try:
            task()
        except Exception as e:
            errors.append(e)
    if errors:
        raise ExceptionGroup("2 shard syncs failed", errors)


if __name__ == "__main__":
    sync_all_shards()
