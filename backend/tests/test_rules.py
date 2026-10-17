"""Assertions for the assistant's «ƏGƏR … → ONDA …» rules and the guards.

Every example in app/ai/rules.py becomes a test case here: the named rule must fire and produce
exactly the listed tool calls (or a reply containing the listed text). Add an example to a rule and
it is tested automatically.
"""

import json
import uuid as _uuid
from decimal import Decimal

import pytest

from app.ai.guards import ungrounded_amounts
from app.ai.nlu import Context, Utterance
from app.ai.prompts import system_prompt
from app.ai.providers.base import ProviderEvent, ToolCall
from app.ai.rules import MULTI_EXAMPLE, RULES, Reply, plan
from tests.conftest import create_product, publish

CASES = [(r, mode, e) for r in RULES for e in r.examples
         for mode in (["supplier", "buyer"] if r.mode == "any" else [r.mode])]


def _run(say: str, mode: str, context: str = ""):
    msgs = ([{"role": "assistant", "content": context}] if context else []) + [{"role": "user", "content": say}]
    return plan(say, mode, Context.from_messages(msgs))


@pytest.mark.parametrize("rule,mode,example", CASES, ids=[f"{r.id}[{m}]:{e.say[:40]}" for r, m, e in CASES])
def test_rule_example(rule, mode, example):
    result, fired = _run(example.say, mode, example.context)
    assert fired is not None and fired.id == rule.id, f"expected {rule.id}, fired {fired.id if fired else 'fallback'}"
    if example.calls:
        assert not isinstance(result, Reply), result
        assert [(c.tool, c.args) for c in result] == list(example.calls)
    else:
        assert isinstance(result, Reply) and example.reply in result.text


def test_multi_command_example():
    result, _ = _run(MULTI_EXAMPLE.say, "supplier")
    assert [(c.tool, c.args) for c in result] == list(MULTI_EXAMPLE.calls)


def test_every_rule_has_an_example_and_is_in_the_prompt():
    for mode in ("supplier", "buyer"):
        prompt = system_prompt(mode, "Demo")
        for r in RULES:
            if r.mode in (mode, "any"):
                assert r.examples, f"{r.id} has no example"
                assert r.when in prompt
    assert "11111111-" not in system_prompt("buyer")  # test ids are never shown to the model


def test_unknown_text_falls_back_to_help():
    result, fired = _run("???", "supplier")
    assert fired is None and isinstance(result, Reply) and "başa düşmədim" in result.text


def test_nlu_features():
    u = Utterance("Son 3 ayda 500 ədəd qapı 85 manata satdım, MDF-18 kodu")
    assert u.days == 90
    assert u.money == [Decimal(85)]
    assert [(q.value, q.unit) for q in u.quantities] == [(Decimal(500), "piece")]
    assert Utterance("Bakıdakı topdansatıcılar").city == "Bakı"
    assert Utterance("1-ci elana təklif göndər").quantities == []
    assert Utterance("Taxta qapının qiymətini 90 et").ref() == "Taxta qapı"
    assert Utterance("Kronospan laminatından 5 dənə").ref() == "Kronospan laminat"


def test_ungrounded_amounts():
    evidence = ['{"price": "85.00", "estimated_total": "2125.00"}']
    assert ungrounded_amounts("Qiymət 85 ₼, cəmi 2 125 AZN", evidence) == []
    assert ungrounded_amounts("Ən ucuzu 49 ₼-dir", evidence) == ["49 ₼"]


# ---------------------------------------------------------------------------
# End-to-end through the API (offline mode)
# ---------------------------------------------------------------------------
def _blocks(events, kind):
    return [e["block"] for e in events if e["type"] == "block" and e["block"]["type"] == kind]


def test_guard_exact_duplicate_merges_instead_of_creating(make_supplier):
    s = make_supplier()
    existing = create_product(s, name="Taxta qapı", quantity="10")
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    action = _blocks(s.chat(conv["id"], "Anbarımda 50 taxta qapı var"), "action")[0]["action"]
    assert action["arguments"]["merge_into_product_id"] == existing["id"]
    assert any("10 → 60" in w for w in action["preview"]["warnings"])
    s.post(f"/ai/actions/{action['id']}/confirm", json={})
    assert s.get(s.biz(f"/products/{existing['id']}")).json()["quantity"] == "60"
    assert s.get(s.biz("/products")).json()["total"] == 1


def test_guard_price_jump_warns(make_supplier):
    s = make_supplier()
    create_product(s, name="Taxta qapı", selling_price="90")
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    action = _blocks(s.chat(conv["id"], "Taxta qapının qiymətini 300 AZN et"), "action")[0]["action"]
    assert any("Böyük qiymət dəyişikliyi" in w for w in action["preview"]["warnings"])


def test_supplier_follow_up_uses_context(make_supplier):
    s = make_supplier()
    create_product(s, name="Taxta qapı", quantity="40", selling_price="90")
    create_product(s, name="Laminat panel", quantity="10")
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    events = s.chat(conv["id"], "Taxta qapı neçə dənədir?")
    assert "**Taxta qapı** — 40" in events[-1]["message"]["content"]
    action = _blocks(s.chat(conv["id"], "Onun qiymətini 95 AZN et"), "action")[0]["action"]
    assert action["tool"] == "update_price" and action["preview"]["summary"] == "Taxta qapı"
    actions = [b["action"] for b in _blocks(s.chat(conv["id"], "Laminat panelin qiymətini 20 AZN et və stokunu 3 azalt"),
                                            "action")]
    assert [(a["tool"], a["preview"]["summary"]) for a in actions] == [
        ("update_price", "Laminat panel"), ("update_inventory", "Laminat panel: 10 → 7")]


def test_buyer_quote_follow_up_after_search(make_supplier, make_buyer):
    s = make_supplier(city="Bakı")
    p = create_product(s, name="Ağ MDF qapı", quantity="100", selling_price="85")
    listing = publish(s, p["id"])
    u = make_buyer()
    conv = u.post("/ai/conversations", json={"mode": "buyer"}).json()
    # before any search there is nothing to refer to
    assert not _blocks(u.chat(conv["id"], "Birincisinə təklif göndər"), "action")
    u.chat(conv["id"], "Bakıda 25 ağ MDF qapı lazımdır")
    action = _blocks(u.chat(conv["id"], "Birincisinə təklif göndər"), "action")[0]["action"]
    assert action["tool"] == "create_quote_request"
    assert action["arguments"] == {"listing_ids": [listing["id"]], "quantity": "25"}


def _run_turn(api, conv_id, provider):
    from app.ai import orchestrator
    from app.core.config import get_settings
    from app.db.session import SessionLocal
    from app.models import Conversation, Profile

    with SessionLocal() as db:
        conv = db.get(Conversation, _uuid.UUID(conv_id))
        user = db.get(Profile, _uuid.UUID(api.me["id"]))
        return list(orchestrator.run_turn(db, get_settings(), user=user, conv=conv, text="test", provider=provider))


class Scripted:
    """A fake LLM: first turn makes the given tool calls (or says text), then says 'ok'."""

    name = model = "scripted"

    def __init__(self, calls=None, text=None):
        self.calls, self.text, self.n = calls or [], text, 0

    def stream(self, messages, tools):
        self.n += 1
        if self.n == 1 and self.calls:
            yield ProviderEvent(type="tool_calls", tool_calls=[
                ToolCall(str(i), name, json.dumps(args)) for i, (name, args) in enumerate(self.calls)])
        else:
            yield ProviderEvent(type="text", text=self.text if self.text and self.n == 1 else "ok")


def test_guard_blocks_quote_for_listing_never_shown(make_supplier, make_buyer):
    s = make_supplier()
    listing = publish(s, create_product(s)["id"])
    u = make_buyer()
    conv = u.post("/ai/conversations", json={"mode": "buyer"}).json()
    events = _run_turn(u, conv["id"], Scripted([("create_quote_request", {"listing_ids": [listing["id"]], "quantity": 5})]))
    assert not _blocks(events, "action")
    assert "göstərilmiş elanlara" in _blocks(events, "notice")[0]["text"]


def test_guard_blocks_meaningless_product_name(make_supplier):
    s = make_supplier()
    conv = s.post("/ai/conversations", json={"mode": "supplier", "business_id": s.business_id}).json()
    events = _run_turn(s, conv["id"], Scripted([("create_product", {"name": "bu gün var", "quantity": 5})]))
    assert not _blocks(events, "action")
    assert "aydın deyil" in _blocks(events, "notice")[0]["text"]


def test_invented_price_in_answer_is_flagged(make_supplier, make_buyer):
    u = make_buyer()
    conv = u.post("/ai/conversations", json={"mode": "buyer"}).json()
    events = _run_turn(u, conv["id"], Scripted(text="Ən ucuz MDF qapı 49 ₼-dir."))
    assert "49 ₼" in _blocks(events, "notice")[0]["text"]
    # grounded offline answers are not flagged
    s = make_supplier()
    publish(s, create_product(s)["id"])
    events = u.chat(conv["id"], "Bakıda 25 ağ MDF qapı lazımdır")
    assert _blocks(events, "listings") and not _blocks(events, "notice")
