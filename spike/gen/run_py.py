#!/usr/bin/env python3
"""Phase 0 throwaway: run Python trace scenarios, capture stderr byte-exact,
collect runtime-derived goldens, sanitize paths, write fixtures/traces/.

Usage: python3 spike/gen/run_py.py <staging_dir> <venv_dir>
"""
import json
import pathlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
SRC = REPO / "spike" / "gen" / "py"
OUT = REPO / "fixtures" / "traces"

STAGING = pathlib.Path(sys.argv[1]).resolve()
VENV = pathlib.Path(sys.argv[2]).resolve()
PY = VENV / "bin" / "python"

BASE_PREFIX = subprocess.run(
    [str(PY), "-c", "import sys; print(sys.base_prefix)"], capture_output=True, text=True
).stdout.strip()

# Longest-first replacement table: real path -> neutral fixture path
REPLACEMENTS = [
    (str(VENV), "/home/dev/app/.venv"),
    (str(STAGING), "/home/dev/app"),
    (BASE_PREFIX, "/usr"),
    # tmp symlink variants (macOS /private/tmp vs /tmp)
    (str(VENV).replace("/private/tmp", "/tmp"), "/home/dev/app/.venv"),
    (str(STAGING).replace("/private/tmp", "/tmp"), "/home/dev/app"),
]
REPLACEMENTS.sort(key=lambda p: len(p[0]), reverse=True)


def sanitize(text: str) -> str:
    for real, fake in REPLACEMENTS:
        text = text.replace(real, fake)
    return text


def write_fixture(name: str, raw_text: str, golden_path: pathlib.Path | None):
    (OUT / f"{name}.txt").write_text(sanitize(raw_text))
    if golden_path and golden_path.exists():
        (OUT / f"{name}.golden.json").write_text(sanitize(golden_path.read_text()))
        golden_path.unlink()
    print(f"  wrote {name}.txt", flush=True)


def run_scenario(name: str, script: str, capture: str = "stderr"):
    golden = STAGING / "golden.json"
    if golden.exists():
        golden.unlink()
    proc = subprocess.run(
        [str(PY), str(STAGING / script)],
        capture_output=True,
        text=True,
        cwd=STAGING,
        env={"PATH": "/usr/bin:/bin", "GOLDEN_OUT": str(golden), "HOME": str(STAGING)},
        timeout=120,
    )
    raw = proc.stderr if capture == "stderr" else proc.stdout
    write_fixture(name, raw, golden)
    return raw


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    for f in SRC.glob("*.py"):
        shutil.copy(f, STAGING / f.name)

    run_scenario("01-py-attributeerror-deep", "s01_attributeerror_deep.py")
    run_scenario("02-py-chained-context", "s02_chained_context.py")
    run_scenario("03-py-chained-cause", "s03_chained_cause.py")
    run_scenario("04-py-recursionerror-repeated", "s04_recursion_repeated.py")
    run_scenario("05-py-syntaxerror-import", "s05_syntaxerror_import.py")
    run_scenario("06-py-exceptiongroup", "s06_exceptiongroup.py")
    raw07 = run_scenario("07-py-asyncio-chained", "s07_asyncio_chained.py")
    run_scenario("08-py-multiline-message", "s08_multiline_message.py")
    run_scenario("09-py-frozen-importlib", "s09_frozen_importlib.py")
    run_scenario("10-py-module-level", "s10_module_level.py")
    run_scenario("11-py-django-view", "s11_django_view.py")
    run_scenario("12-py-flask-route", "s12_flask_route.py")
    raw13 = run_scenario("13-py-fastapi-decorated", "s13_fastapi_decorated.py")
    run_scenario("14-py-sqlalchemy-chained", "s14_sqlalchemy_chained.py")
    run_scenario("15-py-requests-connectionerror", "s15_requests_connectionerror.py")

    # 16/17: pytest formats (goldens hand-audited later; pytest owns the framing)
    for name, args in [
        ("16-py-pytest-native", ["--tb=native"]),
        ("17-py-pytest-default", []),
    ]:
        proc = subprocess.run(
            [str(VENV / "bin" / "pytest"), "-q", *args, str(STAGING / "test_pricing.py")],
            capture_output=True,
            text=True,
            cwd=STAGING,
        )
        write_fixture(name, proc.stdout, None)

    # 18: real uvicorn server stderr (log lines around a traceback)
    port = _free_port()
    server = subprocess.Popen(
        [str(VENV / "bin" / "uvicorn"), "uvicorn_app:app", "--port", str(port)],
        cwd=STAGING,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        _wait_port(port)
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/checkout/c-999", timeout=10)
        except Exception:
            pass
        time.sleep(0.5)
    finally:
        server.terminate()
        _, err18 = server.communicate(timeout=10)
    write_fixture("18-py-uvicorn-logged", err18, None)

    # 19: JSON-wrapped variant of 01 (structured log line, \n-escaped trace)
    trace01 = (OUT / "01-py-attributeerror-deep.txt").read_text()
    log_line = {
        "timestamp": "2026-07-11T03:22:11.532Z",
        "level": "error",
        "logger": "app.jobs.rebalance",
        "message": "daily rebalance job crashed",
        "exc_info": trace01.rstrip("\n"),
    }
    jsonl = (
        '{"timestamp": "2026-07-11T03:22:10.100Z", "level": "info", "logger": "app.jobs.rebalance", "message": "starting daily rebalance"}\n'
        + json.dumps(log_line)
        + "\n"
        + '{"timestamp": "2026-07-11T03:22:11.540Z", "level": "info", "logger": "app.scheduler", "message": "job finished with status=failed"}\n'
    )
    (OUT / "19-py-json-wrapped.txt").write_text(jsonl)
    shutil.copy(OUT / "01-py-attributeerror-deep.golden.json", OUT / "19-py-json-wrapped.golden.json")
    print("  wrote 19-py-json-wrapped.txt", flush=True)

    # 20: k8s CRI-style per-line prefixed variant of 07 (from the sanitized fixture)
    ts = "2026-07-11T03:25:44.118437221Z"
    trace07 = (OUT / "07-py-asyncio-chained.txt").read_text()
    prefixed = "".join(f"{ts} stderr F {line}\n" for line in trace07.rstrip("\n").split("\n"))
    (OUT / "20-py-k8s-prefixed.txt").write_text(prefixed)
    shutil.copy(OUT / "07-py-asyncio-chained.golden.json", OUT / "20-py-k8s-prefixed.golden.json")
    print("  wrote 20-py-k8s-prefixed.txt", flush=True)

    # keep raw13 referenced so linters don't flag; uvicorn fixture covers server logs
    _ = raw13
    print("PY CORPUS DONE")


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_port(port, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=1).close()
            return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("uvicorn did not start")


if __name__ == "__main__":
    main()
