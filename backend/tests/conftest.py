import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from app.main import app

SEED_PASSWORD = "Passw0rd!123"
SEED_USERS = {
    "design": "priya.nair@example.com",
    "manager": "kavita.iyer@example.com",
    "admin": "nikhil.desai@example.com",
    "top1": "rakesh.menon@example.com",
    "top2": "sunita.rao@example.com",
}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    """auth('design') -> {"Authorization": "Bearer ..."} using the seeded smoke-test users
    (scripts/seed_minimal.py must have been run against the target database first). Session-scoped
    and cached so each role logs in at most once per test run — the login endpoint's per-IP rate
    limiter (app/services/rate_limit.py) sees every TestClient request as the same client, so a
    fresh login per test would trip it well before the suite finishes."""
    cache: dict[str, dict] = {}

    def _login(role_key: str) -> dict:
        if role_key in cache:
            return cache[role_key]
        email = SEED_USERS[role_key]
        role_selected = "top" if role_key.startswith("top") else role_key
        r = client.post("/auth/login", json={"email": email, "password": SEED_PASSWORD, "role_selected": role_selected})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        cache[role_key] = headers
        return headers

    return _login
