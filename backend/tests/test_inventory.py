from decimal import Decimal

from tests.conftest import create_product


def test_create_product_records_initial_event(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="500", purchase_price="60", selling_price="85")
    assert p["quantity"] == "500"
    assert p["inventory_value"] == "30000.00"  # 500 × 60 at cost
    assert p["stock_status"] == "in_stock"
    assert p["category"]["slug"] == "qapi-pencere"  # auto-categorised from "qapı"
    events = s.get(s.biz(f"/inventory/events?product_id={p['id']}")).json()["items"]
    assert [e["event_type"] for e in events] == ["initial"]


def test_adjust_stock_updates_quantity_and_audits(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="100")
    r = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-40", "reason": "Satış"})
    assert r.status_code == 200, r.text
    assert r.json()["product"]["quantity"] == "60"
    ev = r.json()["event"]
    assert (ev["quantity_before"], ev["quantity_after"], ev["delta"]) == ("100", "60", "-40")
    logs = s.get(s.biz("/audit-logs")).json()["items"]
    adj = [l for l in logs if l["action"] == "inventory.adjust"]
    assert adj and adj[0]["after"]["quantity"] == "60.000"


def test_stock_cannot_go_negative(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="10")
    r = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-11"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "insufficient_stock"
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "10"


def test_set_quantity_and_fractional_units(make_supplier):
    s = make_supplier()
    p = create_product(s, name="Laminat 8mm", unit="m2", quantity="120.5")
    r = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"set_quantity": "99.25"})
    assert r.json()["product"]["quantity"] == "99.25"


def test_idempotent_adjust(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="100")
    hdr = {"Idempotency-Key": "adj-123"}
    r1 = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-5"}, headers=hdr)
    r2 = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-5"}, headers=hdr)
    assert r1.json() == r2.json()
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "95"


def test_optimistic_version_conflict(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="100")
    v = p["inventory_version"]
    assert s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "1", "expected_version": v}).status_code == 200
    r = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "1", "expected_version": v})
    assert r.status_code == 409 and r.json()["error"]["code"] == "stale_version"


def test_undo_latest_event_only(make_supplier):
    s = make_supplier()
    p = create_product(s, quantity="100")
    e1 = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-10"}).json()["event"]
    e2 = s.post(s.biz(f"/inventory/{p['id']}/adjust"), json={"delta": "-20"}).json()["event"]
    assert s.post(s.biz(f"/inventory/events/{e1['id']}/undo")).status_code == 409
    r = s.post(s.biz(f"/inventory/events/{e2['id']}/undo"))
    assert r.status_code == 200
    assert r.json()["product"]["quantity"] == "90"
    # undo cannot be applied twice
    assert s.post(s.biz(f"/inventory/events/{e2['id']}/undo")).status_code == 409


def test_low_stock_filter_and_summary(make_supplier):
    s = make_supplier()
    create_product(s, name="Ağ MDF qapı", quantity="5", low_stock_threshold=10, purchase_price="50")
    create_product(s, name="Taxta lövhə", quantity="300", purchase_price="10")
    create_product(s, name="Kafel 30x30", quantity="0", unit="m2", purchase_price="20")
    low = s.get(s.biz("/products?stock=attention")).json()
    assert {i["name"] for i in low["items"]} == {"Ağ MDF qapı", "Kafel 30x30"}
    summ = s.get(s.biz("/inventory/summary")).json()
    assert summ["total_products"] == 3
    assert Decimal(summ["inventory_value"]) == Decimal("3250.00")  # 5×50 + 300×10
    assert summ["out_of_stock_count"] == 1


def test_search_handles_azerbaijani_forms(make_supplier):
    s = make_supplier()
    create_product(s, name="Ağ MDF qapı")
    create_product(s, name="Taxta lövhə")
    res = s.get(s.biz("/products"), params={"q": "qapılar"}).json()
    assert [i["name"] for i in res["items"]] == ["Ağ MDF qapı"]
    res = s.get(s.biz("/products"), params={"q": "white door"}).json()
    assert [i["name"] for i in res["items"]] == ["Ağ MDF qapı"]


def test_csv_import_and_export(make_supplier):
    s = make_supplier()
    csv_content = "sku,name,quantity,unit,purchase_price,selling_price\nDR-1,Palıd qapı,40,ədəd,120,180\n,Gips 25kg,abc,kq,5,7\n"
    files = {"file": ("inv.csv", csv_content.encode("utf-8"), "text/csv")}
    dry = s.post(s.biz("/inventory/import?dry_run=true"), files=files).json()
    assert dry["created"] == 1 and dry["errors"] == 1
    assert s.get(s.biz("/products")).json()["total"] == 0  # dry run wrote nothing
    real = s.post(s.biz("/inventory/import?dry_run=false"), files=files).json()
    assert real["created"] == 1
    # re-import updates quantity via a ledger event instead of overwriting silently
    csv2 = "sku,name,quantity\nDR-1,Palıd qapı,35\n"
    s.post(s.biz("/inventory/import?dry_run=false"), files={"file": ("i.csv", csv2.encode(), "text/csv")})
    items = s.get(s.biz("/products")).json()["items"]
    assert items[0]["quantity"] == "35"
    events = s.get(s.biz(f"/inventory/events?product_id={items[0]['id']}")).json()["items"]
    assert events[0]["event_type"] == "import" and events[0]["delta"] == "-5"
    exp = s.get(s.biz("/inventory/export?format=csv"))
    assert exp.status_code == 200 and "Palıd qapı" in exp.content.decode("utf-8-sig")
    assert s.get(s.biz("/inventory/export?format=xlsx")).status_code == 200


def test_image_upload_rejects_non_images(make_supplier):
    s = make_supplier()
    p = create_product(s)
    bad = s.post(s.biz(f"/products/{p['id']}/images"), files={"file": ("x.png", b"<script>alert(1)</script>", "image/png")})
    assert bad.status_code == 422
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    ok = s.post(s.biz(f"/products/{p['id']}/images"), files={"file": ("a.png", png, "image/png")})
    assert ok.status_code == 201
    assert s.get(s.biz(f"/products/{p['id']}")).json()["images"][0]["url"].endswith(".png")
