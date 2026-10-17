"""Deterministic offline assistant used when no LLM API key is configured.

It runs the rule table in app/ai/rules.py and emits the *same* structured tool calls an LLM
would, so the whole validate → preview → confirm → execute pipeline is exercised identically.
This module keeps the inventory-list parser and the result summaries.
It is clearly labelled as "offline mode" in the UI; it is not a language model.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

from app.ai.providers.base import ProviderEvent, ToolCall
from app.services.lexicon import UNIT_ALIASES, UNIT_LABEL_AZ, analyze, fold, unit_phrase_replace

_NUM = r"\d+(?:[.,]\d+)?"
_CURRENCY = r"(?:azn|manat|man|₼|m\b)"


def _num(s: str) -> str:
    return str(Decimal(s.replace(",", ".")))


# Filler words removed when extracting a product name (folded forms)
_FILLER = {
    "var", "anbarimda", "anbarimizda", "anbarda", "anbara", "anbarima", "elave", "et", "edin", "edek", "inventara", "inventar",
    "stoka", "bizde", "mende", "menim", "i", "have", "we", "add", "to", "inventory", "the", "my", "in", "warehouse",
    "stock", "of", "has", "got", "received", "gelib", "geldi", "teze", "yeni", "eded", "dene", "pieces", "units", "unit",
    "her", "biri", "birinin", "each", "costs", "cost", "qiymeti", "qiymet", "price", "at", "for", "with", "per", "is",
    "are", "there", "hemcinin", "da", "de", "also", "elave-et", "qeyd", "yaz", "please", "zehmet", "olmasa", "ve", "and",
    "ile", "satis", "alis", "maya", "deyeri", "purchase", "selling", "sale", "bir", "adet", "tane", "var.", "olsun",
    "bu", "gun", "bugun", "today", "dunen", "yesterday", "indi", "now", "teze", "aldim", "aldiq", "gelen", "gelib",
}


def _clean_name(original_segment: str) -> str:
    words = []
    for w in re.split(r"\s+", original_segment.strip()):
        f = fold(w).strip(".,;:!?")
        if not f or f in _FILLER or re.fullmatch(_NUM, f) or f in UNIT_ALIASES or re.fullmatch(_CURRENCY, f):
            continue
        if re.fullmatch(rf"{_NUM}(?:azn|manat|₼)", f):
            continue
        words.append(w.strip(".,;:!?"))
    if not words:
        return ""
    # English plural on the head noun: "wooden doors" -> "wooden door"
    last = words[-1]
    if re.fullmatch(r"[A-Za-z]{4,}s", last) and not last.lower().endswith("ss"):
        words[-1] = last[:-1]
    name = " ".join(words)
    return name[0].upper() + name[1:]


def _extract_prices(folded: str) -> tuple[str | None, str | None]:
    """Return (selling_price, purchase_price) found in a folded segment."""
    selling = purchase = None
    m = re.search(rf"(?:alis|purchase|maya deyeri|maya)\D{{0,25}}?({_NUM})", folded)
    if m:
        purchase = _num(m.group(1))
        folded = folded[: m.start()] + " " + folded[m.end():]
    m = (re.search(rf"(?:satis qiymeti|selling price|satis)\D{{0,20}}?({_NUM})", folded)
         or re.search(rf"({_NUM})\s*{_CURRENCY}", folded)
         or re.search(rf"(?:qiymeti|price|costs?|her biri|each|fiyati)\D{{0,20}}?({_NUM})", folded))
    if m:
        selling = _num(m.group(1))
    return selling, purchase


def _split_items(text: str) -> list[str]:
    parts = re.split(r",(?!\d)|;|\n|[.!?](?=\s|$)|\s+(?:və|ve|and|həmçinin|hemçinin|also)\s+", text, flags=re.IGNORECASE)
    return [p.strip() for p in parts if p and p.strip()]


def parse_inventory_items(text: str) -> list[dict[str, Any]]:
    """'Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN'"""
    global_sell, global_buy = _extract_prices(unit_phrase_replace(fold(text)))
    items: list[dict[str, Any]] = []
    price_only_segments = 0
    for seg in _split_items(text):
        f = unit_phrase_replace(fold(seg))
        seg_sell, seg_buy = _extract_prices(f)
        # quantity = first number that is not part of a price expression
        f_wo_prices = re.sub(rf"(?:alis|purchase|maya|satis|qiymeti|price|costs?|her biri|each)\D{{0,25}}?{_NUM}", " ", f)
        f_wo_prices = re.sub(rf"{_NUM}\s*{_CURRENCY}", " ", f_wo_prices)
        qm = re.search(rf"({_NUM})\s*([a-z0-9.]+)?", f_wo_prices)
        if not qm:
            if seg_sell or seg_buy:
                price_only_segments += 1
            continue
        unit = UNIT_ALIASES.get((qm.group(2) or "").rstrip("."))
        orig_wo_numbers = re.sub(rf"\b{_NUM}\s*(?:azn|manat|₼)?", " ", seg, flags=re.IGNORECASE)
        # remove unit words from the original segment
        name = _clean_name(re.sub(r"(?i)\b(kvadrat metr|kv\.? ?m|m²|m2|m³|m3|square meters?|sq\.? m)\b", " ", orig_wo_numbers))
        if not name:
            continue
        items.append({"name": name, "quantity": _num(qm.group(1)), "unit": unit or "piece",
                      "selling_price": seg_sell, "purchase_price": seg_buy})
    # a price stated once for everything ("hər biri 85 AZN") applies to items without their own price
    if items and (global_sell or global_buy):
        explicit = [i for i in items if i["selling_price"] or i["purchase_price"]]
        if not explicit or price_only_segments:
            for i in items:
                i["selling_price"] = i["selling_price"] or global_sell
                i["purchase_price"] = i["purchase_price"] or global_buy
    for i in items:
        concepts, _ = analyze(i["name"])
        colors = [c for c in concepts if c in {"white", "black", "gray", "brown", "red", "blue", "green", "yellow", "beige", "walnut"}]
        if colors:
            i["color"] = colors[0]
    return items


class RuleBasedProvider:
    """Executes the declarative rule table in app/ai/rules.py («ƏGƏR … → ONDA …»)."""

    name = "offline_parser"
    model = "zapcastsat-offline-rules-v2"

    def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Iterator[ProviderEvent]:
        from app.ai.nlu import Context
        from app.ai.rules import Reply, plan

        tool_names = {t["function"]["name"] for t in tools}
        last = messages[-1]
        if last["role"] == "tool":
            yield ProviderEvent(type="text", text=self._summarize(messages))
            return
        mode = "supplier" if "create_product" in tool_names else "buyer"
        result, _rule = plan(last.get("content") or "", mode, Context.from_messages(messages))
        if isinstance(result, Reply):
            yield ProviderEvent(type="text", text=result.text)
            return
        yield ProviderEvent(type="tool_calls", tool_calls=[
            ToolCall(id=f"call_{i}", name=c.tool, arguments=json.dumps(c.args, ensure_ascii=False))
            for i, c in enumerate(result) if c.tool in tool_names
        ])

    # ------------------------------------------------------------------ summaries
    def _summarize(self, messages: list[dict[str, Any]]) -> str:
        results: list[tuple[str, dict]] = []
        i = len(messages) - 1
        while i >= 0 and messages[i]["role"] == "tool":
            try:
                results.insert(0, (messages[i].get("name", ""), json.loads(messages[i]["content"])))
            except (json.JSONDecodeError, TypeError):
                pass
            i -= 1
        lines: list[str] = []
        pending = [r for n, r in results if r.get("status") == "pending_confirmation"]
        for name, r in results:
            if r.get("error") or r.get("status") == "pending_confirmation":
                continue
            lines.append(_summary_for(name, r))
        if pending:
            n = len(pending)
            missing = any(p.get("missing") for p in pending)
            warned = any(p.get("warnings") for p in pending)
            lines.append(
                (f"{n} əməliyyat hazırladım." if n > 1 else "Əməliyyatı hazırladım.")
                + " Zəhmət olmasa, aşağıdakı kartda məlumatları yoxlayın və **Təsdiqlə** düyməsini basın. "
                + "Təsdiqlənənə qədər heç bir dəyişiklik edilmir."
                + (" Bəzi məhsullar üçün satış qiyməti göstərilməyib — kartda əlavə edə bilərsiniz." if missing else "")
                + (" Kartdakı xəbərdarlıqlara diqqət edin." if warned else "")
            )
        for name, r in results:
            if r.get("error"):
                hint = ""
                if r.get("code") == "product_not_found" and name in ("update_price", "update_inventory", "update_product"):
                    hint = (" Adı inventardakı kimi yazın (məs. «Taxta qapı») və ya yeni məhsul kimi əlavə etmək üçün "
                            "miqdarı da göstərin: «Anbarımda 50 … var».")
                lines.append(f"⚠️ {r['error']}{hint}")
        return "\n\n".join(l for l in lines if l) or "Hazırdır."


def _summary_for(name: str, r: dict) -> str:
    if name == "search_inventory":
        if not r.get("total"):
            return "Bu meyarlara uyğun məhsul inventarınızda tapılmadı."
        items = r.get("items") or []
        if 0 < len(items) <= 3:
            rows = [f"- **{i['name']}** — {i['quantity']} {UNIT_LABEL_AZ.get(i['unit'], i['unit'])}"
                    + (f", {i['selling_price']} ₼" if i.get("selling_price") else "") for i in items]
            return "İnventarınızda:\n" + "\n".join(rows)
        return f"İnventarınızda {r['total']} uyğun məhsul tapdım."
    if name == "get_inventory_summary":
        return (f"İnventarınızda {r['total_products']} məhsul, cəmi {r['total_units']} vahid var. "
                f"Ümumi inventar dəyəri: {r['inventory_value']} ₼. Stoku az olan məhsul sayı: {r['low_stock_count']}.")
    if name == "get_sales_analytics":
        items = r.get("items") or []
        if r.get("metric") == "unsold":
            return (f"Son {r['days']} gündə satılmayan {len(items)} məhsul tapdım." if items
                    else f"Son {r['days']} gündə bütün məhsullarınız ən azı bir dəfə satılıb.")
        if not items:
            return f"Son {r['days']} gündə təsdiqlənmiş satış yoxdur, ona görə də gəlir statistikası hələ boşdur."
        top = items[0]
        return (f"Son {r['days']} gündə ümumi gəlir: {r['total_revenue']} ₼. Ən çox gəlir gətirən məhsul: "
                f"**{top['name']}** ({top['revenue']} ₼, {top['units']} vahid).")
    if name == "search_marketplace":
        c = r.get("criteria") or {}
        n = r.get("result_count", 0)
        if n == 0:
            alt = r.get("alternatives") or []
            base = "Təəssüf ki, tələbinizə tam uyğun aktiv təklif tapılmadı."
            if alt:
                base += f" Oxşar {len(alt)} məhsul göstərirəm."
            return base + " İstəsəniz, topdansatıcılara təklif sorğusu göndərə bilərsiniz."
        parts = []
        if c.get("quantity"):
            parts.append(f"{c['quantity']} {UNIT_LABEL_AZ.get(c.get('unit') or 'piece', '')}".strip())
        if c.get("city"):
            parts.append(c["city"])
        crit = f" ({', '.join(parts)})" if parts else ""
        best = r["results"][0]
        return (f"Tələbinizə{crit} uyğun {n} təklif tapdım. Ən uyğun: **{best['title']}** — {best['price']} ₼, "
                f"{best['supplier']}. Kartlardan sifariş verə və ya «birincisinə təklif göndər» yaza bilərsiniz.")
    if name == "compare_offers":
        offers = r.get("offers") or []
        if not offers:
            return "Müqayisə üçün aktiv təklif tapılmadı."
        o = offers[0]
        return f"{len(offers)} təklifi müqayisə etdim. Ən sərfəlisi: **{o['title']}** — {o['price']} ₼ ({o['supplier']})."
    if name == "find_suppliers":
        s = r.get("suppliers") or []
        return f"{len(s)} topdansatıcı tapdım." if s else "Bu meyarla aktiv elanı olan topdansatıcı tapılmadı."
    return ""
