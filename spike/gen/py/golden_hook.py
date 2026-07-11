"""Phase 0 throwaway: excepthook that dumps a golden ParsedTrace JSON from the
runtime's structured traceback (ground truth), then chains to the default hook
so stderr gets the byte-exact interpreter traceback.

Usage: scenario scripts do `import golden_hook` first. Golden path from $GOLDEN_OUT.
"""
import json
import os
import sys
import traceback

_RECURSIVE_CUTOFF = 3  # mirrors traceback._RECURSIVE_CUTOFF


def _frames(te: traceback.TracebackException):
    frames = []
    last_key = None
    count = 0

    def flush():
        if count > _RECURSIVE_CUTOFF:
            frames[-1]["repeated"] = count - _RECURSIVE_CUTOFF

    for f in te.stack:
        key = (f.filename, f.lineno, f.name)
        if key == last_key:
            count += 1
            if count <= _RECURSIVE_CUTOFF:
                frames.append({"rawPath": f.filename, "line": f.lineno, "symbol": f.name})
        else:
            flush()
            last_key = key
            count = 1
            frames.append({"rawPath": f.filename, "line": f.lineno, "symbol": f.name})
    flush()
    return frames


def _build(te: traceback.TracebackException):
    d = {
        "exception": {"type": te.exc_type_str, "message": str(te)},
        "frames": _frames(te),
    }
    if te.__cause__ is not None:
        d["chained"] = {"relation": "cause", "trace": _build(te.__cause__)}
    elif te.__context__ is not None and not te.__suppress_context__:
        d["chained"] = {"relation": "context", "trace": _build(te.__context__)}
    return d


def _hook(exc_type, exc, tb):
    out = os.environ.get("GOLDEN_OUT")
    if out:
        te = traceback.TracebackException(exc_type, exc, tb)
        golden = {"language": "python", **_build(te)}
        with open(out, "w") as fh:
            json.dump(golden, fh, indent=2)
    sys.__excepthook__(exc_type, exc, tb)


sys.excepthook = _hook
