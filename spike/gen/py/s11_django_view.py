import golden_hook  # noqa: F401

import django
from django.conf import settings

settings.configure(
    DEBUG=False,
    ALLOWED_HOSTS=["*"],
    ROOT_URLCONF=__name__,
    SECRET_KEY="phase0-spike",
    DATABASES={},
)
django.setup()

from django.http import JsonResponse  # noqa: E402
from django.urls import path  # noqa: E402


def order_detail(request, order_id):
    orders = {1: {"status": "shipped"}}
    return JsonResponse(orders[order_id])


urlpatterns = [path("orders/<int:order_id>/", order_detail)]

if __name__ == "__main__":
    from django.test import Client

    Client().get("/orders/42/")
