"""End-to-end acceptance workflows over the HTTP API."""

from decimal import Decimal

from tests.conftest import create_product, publish


def test_marketplace_browse_and_smart_search(client, make_supplier):
    a = make_supplier("Bakı Qapı", city="Bakı")
    b = make_supplier("Gəncə Taxta", city="Gəncə")
    pa = create_product(a, name="Ağ MDF qapı", selling_price="95", quantity="10")
    pb = create_product(b, name="Ağ MDF qapı premium", selling_price="80", quantity="100")
    pc = create_product(b, name="Ağ boya 10L", unit="l", selling_price="30", quantity="100")
    for s, p in ((a, pa), (b, pb), (b, pc)):
        publish(s, p["id"])
    res = client.get("/api/v1/marketplace/listings", params={"q": "qapı", "sort": "price_asc"}).json()
    assert [i["price"] for i in res["items"]] == ["80.00", "95.00"]
    smart = client.post("/api/v1/marketplace/smart-search", json={"query": "Bakıda 25 ağ MDF qapı lazımdır"}).json()
    titles = [r["listing"]["title"] for r in smart["results"]]
    assert "Ağ boya 10L" not in titles  # white paint is not a door
    # Gəncə offer has enough stock and is cheaper; Bakı offer is local but only 10 in stock
    by_title = {r["listing"]["title"]: r for r in smart["results"]}
    assert by_title["Ağ MDF qapı"]["stock_ok"] is False and "same_city" in by_title["Ağ MDF qapı"]["reasons"]
    assert by_title["Ağ MDF qapı premium"]["stock_ok"] is True
    assert client.get("/api/v1/marketplace/cities").json()["items"] == ["Bakı", "Gəncə"]
    sup = client.get(f"/api/v1/marketplace/suppliers/{a.me['memberships'][0]['business']['slug']}").json()
    assert sup["active_listings"] == 1


def test_archived_or_paused_products_not_public(client, make_supplier):
    s = make_supplier()
    p = create_product(s)
    l = publish(s, p["id"])
    s.patch(s.biz(f"/listings/{l['id']}"), json={"status": "paused"})
    assert client.get(f"/api/v1/marketplace/listings/{l['id']}").status_code == 404
    s.patch(s.biz(f"/listings/{l['id']}"), json={"status": "active"})
    s.post(s.biz("/products/archive"), json={"ids": [p["id"]]})
    assert client.get(f"/api/v1/marketplace/listings/{l['id']}").status_code == 404


def test_quote_request_to_quotation_to_order(make_supplier, make_buyer):
    """Acceptance: buyer requests a quote, supplier receives and responds, buyer accepts, order is fulfilled."""
    s = make_supplier()
    p = create_product(s, name="Ağ MDF qapı", quantity="100", selling_price="85")
    l = publish(s, p["id"], min_order_qty="5")
    u = make_buyer()

    r = u.post("/quote-requests", json={"listing_ids": [l["id"]], "quantity": "25", "notes": "Bakıya çatdırılma"},
               headers={"Idempotency-Key": "qr-1"})
    assert r.status_code == 201, r.text
    r2 = u.post("/quote-requests", json={"listing_ids": [l["id"]], "quantity": "25"}, headers={"Idempotency-Key": "qr-1"})
    assert r2.json() == r.json()  # duplicate submit does not create a second request

    inbox = s.get(s.biz("/quote-requests")).json()["items"]
    assert len(inbox) == 1 and inbox[0]["buyer"]["name"] == "Elvin Usta"
    notes = s.get("/notifications").json()
    assert notes["unread"] >= 1 and notes["items"][0]["type"] == "quote.new"

    qt = s.post(s.biz(f"/quote-requests/{inbox[0]['id']}/quotations"),
                json={"unit_price": "80", "delivery_days": 2, "notes": "Endirimli qiymət"})
    assert qt.status_code == 201, qt.text
    assert qt.json()["total"] == "2000.00"

    mine = u.get("/quote-requests").json()["items"]
    assert mine[0]["status"] == "quoted" and mine[0]["quotations"][0]["unit_price"] == "80.00"
    order = u.post(f"/quotations/{mine[0]['quotations'][0]['id']}/accept", json={"delivery_address": "Bakı, Nəsimi"})
    assert order.status_code == 200, order.text
    order = order.json()
    assert order["status"] == "pending" and order["total"] == "2000.00"

    # supplier confirms → stock decremented through the ledger
    r = s.post(s.biz(f"/orders/{order['id']}/status"), json={"status": "confirmed"})
    assert r.status_code == 200, r.text
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "75"
    ev = s.get(s.biz(f"/inventory/events?product_id={p['id']}")).json()["items"][0]
    assert ev["event_type"] == "sale" and not ev["undoable"]
    assert s.post(s.biz(f"/orders/{order['id']}/status"), json={"status": "pending"}).status_code == 422
    s.post(s.biz(f"/orders/{order['id']}/status"), json={"status": "fulfilled"})
    assert u.get("/orders").json()["items"][0]["status"] == "fulfilled"


def test_direct_order_moq_and_stock_checks(make_supplier, make_buyer):
    s = make_supplier()
    p = create_product(s, quantity="10", selling_price="50")
    l = publish(s, p["id"], min_order_qty="3")
    u = make_buyer()
    assert u.post("/orders", json={"listing_id": l["id"], "quantity": "2"}).json()["error"]["code"] == "below_moq"
    assert u.post("/orders", json={"listing_id": l["id"], "quantity": "11"}).json()["error"]["code"] == "insufficient_stock"
    o = u.post("/orders", json={"listing_id": l["id"], "quantity": "4"}, headers={"Idempotency-Key": "o-1"}).json()
    o2 = u.post("/orders", json={"listing_id": l["id"], "quantity": "4"}, headers={"Idempotency-Key": "o-1"}).json()
    assert o["id"] == o2["id"] and o["total"] == "200.00"
    # stock is checked again at confirmation time
    s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"set_quantity": "1"})
    r = s.post(s.biz(f"/orders/{o['id']}/status"), json={"status": "confirmed"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_stock"
    assert u.post(f"/orders/{o['id']}/cancel").json()["status"] == "cancelled"


def test_cancel_confirmed_order_restocks(make_supplier, make_buyer):
    s = make_supplier()
    p = create_product(s, quantity="10", selling_price="50")
    l = publish(s, p["id"])
    u = make_buyer()
    o = u.post("/orders", json={"listing_id": l["id"], "quantity": "4"}).json()
    s.post(s.biz(f"/orders/{o['id']}/status"), json={"status": "confirmed"})
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "6"
    s.post(s.biz(f"/orders/{o['id']}/status"), json={"status": "cancelled"})
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "10"


def test_analytics_computed_from_records(make_supplier, make_buyer):
    """Acceptance: dashboard values are derived from real records; empty business shows zeros, not demo data."""
    s = make_supplier()
    empty = s.get(s.biz("/analytics/overview")).json()
    assert empty["metrics"]["monthly_revenue"] == "0.00" and empty["metrics"]["total_products"] == 0
    assert empty["has_sales"] is False and empty["top_products"] == []

    p1 = create_product(s, name="Ağ MDF qapı", quantity="100", selling_price="85", purchase_price="60")
    p2 = create_product(s, name="Taxta lövhə", quantity="5", selling_price="20", purchase_price="12", low_stock_threshold=10)
    l1 = publish(s, p1["id"])
    u = make_buyer()
    o1 = u.post("/orders", json={"listing_id": l1["id"], "quantity": "10"}).json()
    u.post("/orders", json={"listing_id": l1["id"], "quantity": "2"})  # stays pending → not revenue
    s.post(s.biz(f"/orders/{o1['id']}/status"), json={"status": "confirmed"})

    ov = s.get(s.biz("/analytics/overview")).json()
    m = ov["metrics"]
    assert m["monthly_revenue"] == "850.00"
    assert m["total_products"] == 2
    assert Decimal(m["total_units"]) == Decimal("95")
    assert m["inventory_value"] == "5460.00"  # 90×60 + 5×12
    assert m["active_orders"] == 2
    assert m["low_stock_products"] == 1
    assert ov["top_products"][0] == {"name": "Ağ MDF qapı", "revenue": "850.00", "units": "10"}
    assert sum(Decimal(x["revenue"]) for x in ov["series"]) == Decimal("850.00")
    unsold = s.get(s.biz("/analytics/sales?metric=unsold")).json()["items"]
    assert [i["name"] for i in unsold] == ["Taxta lövhə"]


def test_favorites(make_supplier, make_buyer):
    s = make_supplier()
    l = publish(s, create_product(s)["id"])
    u = make_buyer()
    assert u.c.put(f"/api/v1/favorites/{l['id']}", headers=u.h).status_code == 204
    assert u.c.put(f"/api/v1/favorites/{l['id']}", headers=u.h).status_code == 204
    assert u.get("/favorites").json()["ids"] == [l["id"]]
    u.delete(f"/favorites/{l['id']}")
    assert u.get("/favorites").json()["ids"] == []


def test_onboarding_and_me(client, make_supplier, make_buyer):
    s = make_supplier()
    assert s.me["roles"] == ["supplier"] and s.me["primary_role"] == "supplier"
    u = make_buyer()
    assert u.me["roles"] == ["buyer"]
    assert s.post("/onboarding/supplier", json={"business_name": "İkinci", "phone": "+994500000000", "city": "Bakı"}).status_code == 409
    bad = u.post("/onboarding/supplier", json={"business_name": "X", "phone": "1", "city": ""})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_failed"
