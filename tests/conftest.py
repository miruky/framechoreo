import socket

import pandas as pd
import pytest


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Tests must not use the network")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)


@pytest.fixture
def sales():
    return pd.DataFrame(
        {
            "order": ["o01", "o02", "o03", "o04", "o05", "o06"],
            "product": ["P1", "P2", "P1", "P3", "P2", "P4"],
            "amount": [120, 80, 150, 60, 90, 40],
            "paid": [True, False, True, True, True, True],
        }
    )


@pytest.fixture
def products():
    return pd.DataFrame(
        {"product": ["P1", "P2", "P3"], "category": ["Books", "Stationery", "Stationery"]}
    )
