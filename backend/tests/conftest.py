from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="zapcastsat-test-"))
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["ENVIRONMENT"] = "test"
os.environ["AUTH_PROVIDER"] = "local"
os.environ["LLM_API_KEY"] = ""
os.environ["LOCAL_UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["AI_RATE_LIMIT_PER_MINUTE"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.rate_limit import limiter  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clean_state(client):
    """Each test starts with an empty database (reference categories are kept)."""
    from app.db.session import engine
    from app.models import Base

    limiter.reset()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "product_categories":
                conn.execute(table.delete())


class Api:
    def __init__(self, client: TestClient, token: str, me: dict):
        self.c = client
        self.token = token
        self.me = me

    @property
    def h(self):
        return {"Authorization": f"Bearer {self.token}"}

    def get(self, url, **kw):
        return self.c.get(f"/api/v1{url}", headers={**self.h, **kw.pop("headers", {})}, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post(f"/api/v1{url}", json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def patch(self, url, json=None, **kw):
        return self.c.patch(f"/api/v1{url}", json=json, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def delete(self, url, **kw):
        return self.c.delete(f"/api/v1{url}", headers={**self.h, **kw.pop("headers", {})}, **kw)

    @property
    def business_id(self) -> str:
        return self.me["memberships"][0]["business"]["id"]

    def biz(self, path: str) -> str:
        return f"/businesses/{self.business_id}{path}"

    def chat(self, conversation_id: str, text: str) -> list[dict]:
        import json as _json

        r = self.post(f"/ai/conversations/{conversation_id}/messages", json={"content": text})
        assert r.status_code == 200, r.text
        events = []
        for chunk in r.text.split("\n\n"):
            for line in chunk.splitlines():
                if line.startswith("data: "):
                    events.append(_json.loads(line[6:]))
        return events


def register(client: TestClient, name: str = "Test") -> Api:
    email = f"{name.lower()}-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "password": "sirr-parol-123", "full_name": name})
    assert r.status_code == 201, r.text
    data = r.json()
    return Api(client, data["access_token"], data["user"])


@pytest.fixture
def make_supplier(client):
    def _make(name: str = "Taxta Dünyası", city: str = "Bakı") -> Api:
        api = register(client, "supplier")
        r = api.post("/onboarding/supplier", json={"business_name": name, "phone": "+994501112233", "city": city})
        assert r.status_code == 201, r.text
        api.me = r.json()
        return api

    return _make


@pytest.fixture
def make_buyer(client):
    def _make(city: str = "Bakı") -> Api:
        api = register(client, "usta")
        r = api.post("/onboarding/buyer", json={"full_name": "Elvin Usta", "phone": "+994551234567", "city": city,
                                                "specialty": "Dülgər"})
        assert r.status_code == 200, r.text
        api.me = r.json()
        return api

    return _make


def create_product(api: Api, **kw) -> dict:
    body = {"name": "Ağ MDF qapı", "unit": "piece", "selling_price": "85", "purchase_price": "60", "quantity": "100"} | kw
    r = api.post(api.biz("/products"), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def publish(api: Api, product_id: str, **kw) -> dict:
    r = api.post(api.biz("/listings"), json={"product_id": product_id, **kw})
    assert r.status_code == 201, r.text
    return r.json()
