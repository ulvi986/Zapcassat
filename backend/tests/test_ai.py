import json
from decimal import Decimal

import httpx

from app.ai.providers.openai_compat import OpenAICompatibleProvider
from app.ai.providers.rule_based import RuleBasedProvider, parse_inventory_items
from app.ai.tools import TOOLS
from app.services.marketplace import parse_requirement
from tests.conftest import create_product


def _blocks(events, kind=None):
    return [e["block"] for e in events if e["type"] == "block" and (kind is None or e["block"]["type"] == kind)]


def test_parse_inventory_message_az():
    items = parse_inventory_items("Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var.")
    assert [(i["name"], i["quantity"], i["unit"]) for i in items] == [
        ("Taxta qapı", "500", "piece"), ("Taxta lövhə", "300", "piece"), ("Laminat panel", "120", "piece")]


def test_parse_inventory_message_en_with_price():
    items = parse_inventory_items("I have 500 wooden doors. Each costs 85 AZN.")
    assert len(items) == 1
    assert items[0]["name"] == "Wooden door"
    assert items[0]["quantity"] == "500"
    assert items[0]["selling_price"] == "85"


def test_parse_units_and_prices():
    items = parse_inventory_items("200 kv.m laminat 12 manat, 50 kq gips alış qiyməti 4 satış 6")
    assert items[0]["unit"] == "m2" and items[0]["selling_price"] == "12"
    assert items[1]["unit"] == "kg" and items[1]["purchase_price"] == "4" and items[1]["selling_price"] == "6"


def test_requirement_parsing():
    c = parse_requirement("Bakıda 25 ağ MDF qapı lazımdır, ucuz variantları göstər")
    assert c.quantity == Decimal("25") and c.city == "Bakı" and c.prefer_cheap
    assert c.nouns == ["door"] and set(c.modifiers) == {"white", "mdf"}
    c = parse_requirement("Find 100 square meters of affordable laminate")
    assert c.quantity == Decimal("100") and c.unit == "m2" and c.nouns == ["laminate"]


def test_tool_args_are_validated():
    spec = TOOLS["update_inventory"]
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        spec.validate({"product": "x"})  # neither change nor set_quantity
    with pytest.raises(ValidationError):
        spec.validate({"product": "x", "change": 1, "business_id": "other"})  # extra args forbidden
    with pytest.raises(ValidationError):
        TOOLS["create_product"].validate({"name": "Qapı", "quantity": -5})


def test_supplier_ai_flow_create_confirm_and_table_updates(make_supplier):
    """Acceptance: supplier enters an inventory message, reviews, confirms, sees the table update."""
    s = make_supplier()
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    events = s.chat(conv["id"], "Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN")
    actions = [b["action"] for b in _blocks(events, "action")]
    assert [a["arguments"]["name"] for a in actions] == ["Taxta qapı", "Taxta lövhə", "Laminat panel"]
    assert all(a["status"] == "pending" for a in actions)
    assert events[-1]["type"] == "done" and "Təsdiqlə" in events[-1]["message"]["content"]
    # nothing written before confirmation
    assert s.get(s.biz("/products")).json()["total"] == 0

    r = s.post(f"/ai/actions/{actions[0]['id']}/confirm", json={"overrides": {"purchase_price": "60"}})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "executed"
    # confirming twice is idempotent
    assert s.post(f"/ai/actions/{actions[0]['id']}/confirm", json={}).json()["status"] == "executed"
    s.post(f"/ai/actions/{actions[1]['id']}/reject")
    assert s.post(f"/ai/actions/{actions[1]['id']}/confirm", json={}).status_code == 409

    items = s.get(s.biz("/products")).json()["items"]
    assert len(items) == 1
    assert (items[0]["name"], items[0]["quantity"], items[0]["selling_price"], items[0]["purchase_price"]) == \
        ("Taxta qapı", "500", "85.00", "60.00")
    ev = s.get(s.biz(f"/inventory/events?product_id={items[0]['id']}")).json()["items"][0]
    assert ev["source"] == "ai"
    # history re-renders with updated action status
    msgs = s.get(f"/ai/conversations/{conv['id']}").json()["messages"]
    statuses = [b["action"]["status"] for m in msgs for b in m["blocks"] if b["type"] == "action"]
    assert statuses == ["executed", "rejected", "pending"]


def test_ai_create_detects_existing_product(make_supplier):
    s = make_supplier()
    existing = create_product(s, name="Taxta qapı", quantity="10")
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    action = _blocks(s.chat(conv["id"], "50 taxta qapı əlavə et"), "action")[0]["action"]
    assert action["preview"]["matches"][0]["id"] == existing["id"]
    s.post(f"/ai/actions/{action['id']}/confirm", json={"overrides": {"merge_into_product_id": existing["id"]}})
    assert s.get(s.biz(f"/products/{existing['id']}")).json()["quantity"] == "60"
    assert s.get(s.biz("/products")).json()["total"] == 1


def test_ai_price_and_stock_updates(make_supplier):
    s = make_supplier()
    p = create_product(s, name="Ağ MDF qapı", quantity="100", selling_price="90")
    create_product(s, name="Taxta lövhə", quantity="15")
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()

    a = _blocks(s.chat(conv["id"], "Ağ MDF qapının qiymətini 85 AZN et"), "action")[0]["action"]
    assert a["tool"] == "update_price"
    s.post(f"/ai/actions/{a['id']}/confirm", json={})
    assert s.get(s.biz(f"/products/{p['id']}")).json()["selling_price"] == "85.00"

    a = _blocks(s.chat(conv["id"], "Reduce the stock of white MDF door by 40 units"), "action")[0]["action"]
    assert a["tool"] == "update_inventory" and a["arguments"]["change"] == "-40"
    s.post(f"/ai/actions/{a['id']}/confirm", json={})
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "60"

    # insufficient stock: confirmation fails and the action stays pending for correction
    a = _blocks(s.chat(conv["id"], "Ağ MDF qapının stokunu 500 ədəd azalt"), "action")[0]["action"]
    r = s.post(f"/ai/actions/{a['id']}/confirm", json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_stock"
    assert s.get(s.biz(f"/products/{p['id']}")).json()["quantity"] == "60"

    table = _blocks(s.chat(conv["id"], "20 ədəddən az qalan məhsulları göstər"), "inventory_table")[0]
    assert [i["name"] for i in table["items"]] == ["Taxta lövhə"]

    summ = _blocks(s.chat(conv["id"], "İnventar xülasəsi"), "inventory_summary")[0]
    assert summ["data"]["total_products"] == 2


def test_ai_sales_analytics_uses_real_data(make_supplier):
    s = make_supplier()
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    events = s.chat(conv["id"], "Bu ay ən çox gəlir gətirən məhsullar hansılardır?")
    data = _blocks(events, "analytics")[0]["data"]
    assert data["items"] == [] and data["total_revenue"] == "0.00"
    assert "satış yoxdur" in events[-1]["message"]["content"]


def test_buyer_ai_search_returns_real_listings_only(make_supplier, make_buyer):
    s = make_supplier(city="Bakı")
    p = create_product(s, name="Ağ MDF qapı", quantity="100", selling_price="85")
    s.post(s.biz("/listings"), json={"product_id": p["id"]})
    u = make_buyer()
    conv = u.post("/ai/conversations", json={"mode": "buyer"}).json()
    block = _blocks(u.chat(conv["id"], "Bakıda 25 ağ MDF qapı lazımdır. Ucuz variantları göstər."), "listings")[0]
    assert len(block["results"]) == 1
    assert block["results"][0]["listing"]["title"] == "Ağ MDF qapı"
    assert block["results"][0]["estimated_total"] == "2125.00"
    assert "stock_sufficient" in block["results"][0]["reasons"]
    empty = _blocks(u.chat(conv["id"], "50 şüşə pəncərə lazımdır"), "listings")[0]
    assert empty["results"] == []


def test_ai_daily_limit(make_supplier, monkeypatch):
    from app.core.config import get_settings

    s = make_supplier()
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    monkeypatch.setattr(get_settings(), "ai_daily_message_limit", 1)
    s.chat(conv["id"], "salam")
    events = s.chat(conv["id"], "salam")
    assert events[-1]["type"] == "error" and events[-1]["code"] == "ai_daily_limit"


def test_openai_compatible_stream_parsing():
    """The provider assembles streamed tool-call fragments correctly (no network)."""
    chunks = [
        {"choices": [{"delta": {"content": "Yoxlayıram"}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "create_product", "arguments": "{\"na"}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "me\": \"Qapı\", \"quantity\": 5}"}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 1, "id": "c2", "function": {"name": "get_inventory_summary", "arguments": "{}"}}]}}]},
    ]
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    prov = OpenAICompatibleProvider(base_url="https://llm.test/v1", api_key="k", model="m", transport=httpx.MockTransport(handler))
    events = list(prov.stream([{"role": "user", "content": "x"}, {"role": "tool", "tool_call_id": "a", "name": "n", "content": "{}"}],
                              [TOOLS["create_product"].openai_schema()]))
    assert events[0].text == "Yoxlayıram"
    calls = events[-1].tool_calls
    assert [(c.name, json.loads(c.arguments)) for c in calls] == [("create_product", {"name": "Qapı", "quantity": 5}),
                                                                   ("get_inventory_summary", {})]
    assert seen["auth"] == "Bearer k"
    assert "name" not in seen["body"]["messages"][1]  # internal key stripped
    assert seen["body"]["tools"][0]["function"]["name"] == "create_product"


def test_llm_hallucinated_args_are_rejected(make_supplier):
    """A model that tries to pass a foreign business id or invalid data gets a validation error, nothing runs."""
    from app.ai import orchestrator
    from app.ai.providers.base import ProviderEvent, ToolCall
    from app.db.session import SessionLocal
    from app.models import Conversation, Profile

    s = make_supplier()
    conv_id = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()["id"]

    class Evil:
        name = "evil"
        model = "evil"

        def __init__(self):
            self.n = 0

        def stream(self, messages, tools):
            self.n += 1
            if self.n == 1:
                yield ProviderEvent(type="tool_calls", tool_calls=[
                    ToolCall("1", "create_product", json.dumps({"name": "X qapı", "quantity": 5, "business_id": "00000000-0000-0000-0000-000000000000"})),
                    ToolCall("2", "search_marketplace", json.dumps({"query": "qapı"})),  # buyer-only tool
                    ToolCall("3", "drop_tables", "{}"),
                ])
            else:
                yield ProviderEvent(type="text", text="ok")

    import uuid as _uuid

    with SessionLocal() as db:
        conv = db.get(Conversation, _uuid.UUID(conv_id))
        user = db.get(Profile, _uuid.UUID(s.me["id"]))
        from app.core.config import get_settings

        events = list(orchestrator.run_turn(db, get_settings(), user=user, conv=conv, text="test", provider=Evil()))
    assert not [e for e in events if e["type"] == "block" and e["block"]["type"] == "action"]
    assert [e["ok"] for e in events if e["type"] == "tool_end"] == [False, False, False]
    assert s.get(s.biz("/products")).json()["total"] == 0


def test_rule_based_help_when_unclear():
    events = list(RuleBasedProvider().stream([{"role": "user", "content": "salam"}],
                                             [TOOLS["create_product"].openai_schema()]))
    assert events[0].type == "text" and "Anbarımda" in events[0].text
