import golden_hook  # noqa: F401

from flask import Flask, jsonify

app = Flask(__name__)
app.testing = True


@app.route("/users/<int:uid>")
def get_user(uid):
    users = {1: "ada", 2: "grace"}
    return jsonify({"name": users[uid]})


if __name__ == "__main__":
    app.test_client().get("/users/7")
