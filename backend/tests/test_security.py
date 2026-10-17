"""Tenant isolation & authorization, including through AI tool calls."""

from tests.conftest import create_product, publish


def test_requires_auth(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_supplier_cannot_access_other_business(make_supplier):
    a = make_supplier("A Ticarət")
    b = make_supplier("B Ticarət")
    pa = create_product(a, name="Gizli qapı", purchase_price="11")
    # read, list, write and stock changes on A's business by B all fail as not-found
    assert b.get(f"/businesses/{a.business_id}/products").status_code == 404
    assert b.get(f"/businesses/{a.business_id}/products/{pa['id']}").status_code == 404
    assert b.patch(f"/businesses/{a.business_id}/products/{pa['id']}", json={"selling_price": "1"}).status_code == 404
    assert b.post(f"/businesses/{a.business_id}/inventory/{pa['id']}/adjust", json={"delta": "-1"}).status_code == 404
    # using B's own business id with A's product id also fails
    assert b.get(b.biz(f"/products/{pa['id']}")).status_code == 404
    assert b.post(b.biz(f"/inventory/{pa['id']}/adjust"), json={"delta": "-1"}).status_code == 404
    assert a.get(a.biz(f"/products/{pa['id']}")).json()["quantity"] == "100"


def test_ai_tools_cannot_touch_other_business(make_supplier):
    a = make_supplier("A Ticarət")
    b = make_supplier("B Ticarət")
    pa = create_product(a, name="Qırmızı palıd qapı", quantity="50")
    conv = b.post("/ai/conversations", json={"mode": "supplier", "business_id": b.business_id}).json()
    # B's assistant cannot see or modify A's product, even by exact id
    events = b.chat(conv["id"], f"{pa['id']} stokunu 40 ədəd azalt")
    actions = [e["block"]["action"] for e in events if e["type"] == "block" and e["block"]["type"] == "action"]
    assert actions == []
    events = b.chat(conv["id"], "Qırmızı palıd qapının qiymətini 1 AZN et")
    assert not [e for e in events if e["type"] == "block" and e["block"]["type"] == "action"]
    # B cannot open a conversation bound to A's business
    assert b.post("/ai/conversations", json={"mode": "supplier", "business_id": a.business_id}).status_code == 404
    assert a.get(a.biz(f"/products/{pa['id']}")).json()["quantity"] == "50"


def test_ai_action_cannot_be_confirmed_by_another_user(make_supplier):
    a = make_supplier("A Ticarət")
    b = make_supplier("B Ticarət")
    conv = a.post("/ai/conversations", json={"mode": "supplier", "business_id": a.business_id}).json()
    events = a.chat(conv["id"], "Anbarımda 30 taxta qapı var")
    action = next(e["block"]["action"] for e in events if e["type"] == "block" and e["block"]["type"] == "action")
    assert b.post(f"/ai/actions/{action['id']}/confirm", json={}).status_code == 404
    assert a.get(a.biz("/products")).json()["total"] == 0


def test_ai_conversation_is_private(make_supplier):
    a = make_supplier()
    b = make_supplier()
    conv = a.post("/ai/conversations", json={"mode": "supplier", "business_id": a.business_id}).json()
    assert b.get(f"/ai/conversations/{conv['id']}").status_code == 404
    assert b.post(f"/ai/conversations/{conv['id']}/messages", json={"content": "salam"}).status_code == 404


def test_public_listing_hides_private_fields(client, make_supplier):
    s = make_supplier()
    p = create_product(s, purchase_price="60", selling_price="85")
    l = publish(s, p["id"])
    pub = client.get(f"/api/v1/marketplace/listings/{l['id']}").json()
    assert "purchase_price" not in str(pub)
    assert pub["price"] == "85.00"
    # hiding stock hides the quantity publicly
    s.patch(s.biz(f"/listings/{l['id']}"), json={"show_stock": False})
    assert client.get(f"/api/v1/marketplace/listings/{l['id']}").json()["available_quantity"] is None


def test_buyer_cannot_use_supplier_endpoints(make_buyer, make_supplier):
    s = make_supplier()
    u = make_buyer()
    assert u.get(f"/businesses/{s.business_id}/orders").status_code == 404
    assert u.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).status_code == 404


def test_supplier_cannot_quote_own_listing(make_supplier):
    s = make_supplier()
    s.post("/onboarding/buyer", json={"full_name": "X", "phone": "+994501111111", "city": "Bakı"})
    p = create_product(s)
    l = publish(s, p["id"])
    r = s.post("/quote-requests", json={"listing_ids": [l["id"]], "quantity": "5"})
    assert r.status_code == 403


def test_login_rejects_wrong_password(client):
    client.post("/api/v1/auth/register", json={"email": "x@example.com", "password": "duzgun-parol-1"})
    r = client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "sehv-parol-11"})
    assert r.status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "X@example.com", "password": "duzgun-parol-1"}).status_code == 200
