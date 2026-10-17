"""A new supplier's products reach mechanics without a separate publish step, and becoming a
mechanic (buyer) needs no extra answers."""

from tests.conftest import create_product, register


def _market_titles(api, q):
    return [l["title"] for l in api.get(f"/marketplace/listings?q={q}").json()["items"]]


def test_priced_product_is_on_the_market_immediately(make_supplier, make_buyer):
    s = make_supplier(name="Lider Group")
    p = create_product(s, name="NGK şam", selling_price="24", quantity="500")
    assert p["listing"]["status"] == "active"
    assert "NGK şam" in _market_titles(make_buyer(), "NGK")


def test_product_stays_private_without_price_or_when_opted_out(make_supplier, make_buyer):
    s = make_supplier()
    assert create_product(s, name="Yağ filtri", selling_price=None)["listing"] is None
    assert create_product(s, name="Hava filtri", publish=False)["listing"] is None
    assert _market_titles(make_buyer(), "filtri") == []


def test_ai_created_product_is_published_on_confirm(make_supplier, make_buyer):
    s = make_supplier()
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    events = s.chat(conv["id"], "Anbarıma 200 ədəd praqlatka əlavə et, qiyməti 17 manat")
    action = next(e["block"]["action"] for e in events if e["type"] == "block" and e["block"]["type"] == "action")
    assert any(f["key"] == "marketplace" for f in action["preview"]["fields"])
    s.post(f"/ai/actions/{action['id']}/confirm", json={})
    assert _market_titles(make_buyer(), "praqlatka")


def test_mechanic_onboarding_asks_nothing(client):
    api = register(client, "Usta")
    r = api.post("/onboarding/buyer", json={})
    assert r.status_code == 200, r.text
    me = r.json()
    assert "buyer" in me["roles"] and me["specialty"] == "Maşın ustası"
    assert me["full_name"] == "Usta"  # kept from sign-up
