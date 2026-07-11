"""Phase 0 throwaway: generate real tracebacks whose frames land inside a
flask CHECKOUT (not the installed package). Usage: python res_flask.py <flask_clone> <outdir>
"""
import pathlib
import sys
import traceback

CLONE = pathlib.Path(sys.argv[1]).resolve()
OUT = pathlib.Path(sys.argv[2]).resolve()
sys.path.insert(0, str(CLONE / "src"))

import flask  # noqa: E402

assert pathlib.Path(flask.__file__).is_relative_to(CLONE), "clone not imported"

from flask import Flask, render_template_string  # noqa: E402

app = Flask(__name__)
app.testing = True


@app.route("/orders/<order_id>")
def order_detail(order_id):
    orders = {"o-1": {"total": 42}}
    return orders[order_id]


@app.route("/report")
def report():
    return render_template_string("total: {{ items + 1 }}", items=None)


@app.before_request
def guard():
    if flask.request.path.startswith("/admin"):
        raise PermissionError("admin area disabled in this deployment")


@app.route("/admin/panel")
def admin_panel():
    return "ok"


def capture(path, name):
    try:
        app.test_client().get(path)
    except Exception as e:
        text = "".join(traceback.format_exception(e))
        (OUT / name).write_text(text)
        print(f"  wrote {name} ({text.count(chr(10))} lines)")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    capture("/orders/o-404", "flask-keyerror.txt")
    capture("/report", "flask-template.txt")
    capture("/admin/panel", "flask-before-request.txt")
