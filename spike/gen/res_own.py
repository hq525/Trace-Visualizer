"""Phase 0 throwaway: real tracebacks through the media-compression-backend
repo COPY via TestClient + fault injection. Usage: python res_own.py <repo_copy> <outdir>
"""
import pathlib
import sys
import traceback

REPO = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(sys.argv[2]).resolve()
sys.path.insert(0, str(REPO))

from fastapi.testclient import TestClient  # noqa: E402

from app import database  # noqa: E402
from app.main import app  # noqa: E402


def capture(fn, name):
    try:
        fn()
    except Exception as e:
        text = "".join(traceback.format_exception(e))
        (OUT / name).write_text(text)
        print(f"  wrote {name} ({text.count(chr(10))} lines)")


def db_fault():
    with TestClient(app) as client:
        # after startup, point the module's DB path at an unopenable location:
        # every route that touches the DB now fails inside app/database.py
        original = database.DATABASE_PATH
        database.DATABASE_PATH = pathlib.Path("/nonexistent-dir/app.db")
        try:
            client.post(
                "/api/auth/signup",
                json={"email": "phase0@example.com", "password": "hunter2hunter2"},
            )
        finally:
            database.DATABASE_PATH = original


def corrupt_upload():
    with TestClient(app) as client:
        client.post(
            "/api/auth/signup",
            json={"email": "phase0b@example.com", "password": "hunter2hunter2"},
        )
        client.post(
            "/api/media",
            files={"file": ("photo.png", b"\x89PNG\r\n\x1a\nGARBAGE-NOT-A-REAL-PNG", "image/png")},
        )


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    capture(db_fault, "own-db-fault.txt")
    capture(corrupt_upload, "own-corrupt-upload.txt")
