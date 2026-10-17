"""Assistant behaviour rules: «ƏGƏR belədirsə → ONDA belə et».

One declarative table drives both assistant modes:

* **Offline mode** executes it. Rules are tried from the highest priority down; the first rule whose
  `match` is true and whose `act` returns a plan wins (`act` may return None to let lower rules try).
* **LLM mode** receives the same `when` / `then` sentences and examples in its system prompt
  (see prompts.py), so both modes are told the same thing.
* Every example is an **assertion**: tests/test_rules.py runs each one and checks that this exact rule
  fires and produces exactly these tool calls (or a reply containing the given text).

Adding a behaviour = adding a Rule with a priority, a `when`/`then` sentence, `match`, `act` and at
least one example. Safety does not depend on these rules: tool arguments are validated, tenant
scoping is enforced in code, writes need confirmation, and guards.py re-checks every tool call.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.ai.nlu import NUM, Context, Utterance, plain

Mode = str  # "supplier" | "buyer" | "any"


@dataclass(frozen=True)
class Call:
    tool: str
    args: dict[str, Any]


@dataclass(frozen=True)
class Reply:
    text: str


Plan = list[Call] | Reply


@dataclass(frozen=True)
class Example:
    say: str
    calls: tuple[tuple[str, dict[str, Any]], ...] = ()
    reply: str | None = None  # expected substring of the reply when no tool is called
    context: str = ""  # an earlier assistant message, including its "[context: …]" line
    prompt: bool = True  # also show this example to the LLM


def ex(say: str, *calls: tuple[str, dict[str, Any]], reply: str | None = None, context: str = "",
       prompt: bool = True) -> Example:
    return Example(say, tuple(calls), reply, context, prompt)


@dataclass(frozen=True)
class Rule:
    id: str
    mode: Mode
    priority: int
    when: str
    then: str
    match: Callable[[Utterance], bool]
    act: Callable[[Utterance], Plan | None]
    examples: tuple[Example, ...] = field(default_factory=tuple)


# ---------------------------------------------------------------------------
# Vocabulary (folded: ə→e, ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u). Matching is by word start.
# ---------------------------------------------------------------------------
FILLER = {"ve", "men", "mene", "sen", "siz", "bir", "cox", "da", "de", "hem", "ki", "e", "ya", "dostum", "qardas",
          "hormetli", "xanim", "bey", "muellim", "bele", "ele", "hele", "bes"}
GREET = {"salam", "slm", "salamlar", "hello", "hi", "hey", "merhaba", "selam", "sabahiniz", "sabah", "xeyir", "axsaminiz",
         "gunortaniz", "privet", "aleykum", "eleykum", "necesen", "necesiz", "nasilsin", "nasilsiniz", "how", "are", "you",
         "yaxsisan", "yaxsisiniz", "good", "morning", "evening", "neynirsen", "isler", "nece", "gedir"}
THANKS = {"sag", "ol", "olun", "sagol", "sagolun", "tesekkur", "tesekkurler", "edirem", "edirik", "thanks", "thank",
          "you", "mersi", "eyvallah", "super", "ela", "yaxsi", "oldu", "ok", "okay", "oke", "tamam", "anladim",
          "aydindir", "aydin", "cox", "gozel", "great", "nice", "perfect", "minnetdaram"}
CAPABILITY = ("ne ede bilirsen", "ne edirsen", "ne bacarirsan", "nece komek", "komek et", "komek ede", "help", "yardim",
              "kimsen", "sen kimsen", "what can you do", "who are you", "nece isleyir", "nece istifade", "ne yaza bilerem")

PRICE = ("qiymet", "price", "fiyat", "deyeri", "deyerini")
ADD = ("elave", "anbarimda", "anbarimiza", "anbarimizda", "anbara", "anbarda", "var", "geldi", "gelib", "aldim", "aldiq",
       "add", "received", "have", "got", "teze mal", "yeni mal", "mehsul gel", "inventara", "stoka")
DEC = ("azalt", "cixart", "cixdi", "satdim", "satdiq", "satildi", "sold", "reduce", "decrease", "remove", "minus",
       "istifade", "xarab", "itdi", "sindi", "qaytardim", "dus")
INC = ("artir", "increase", "add to stock", "plus")
STOCK = ("sayi", "sayin", "miqdar", "stok", "qaliq", "quantity", "stock", "count")
SET = ("olsun", "et", "edin", "ele", "to", "set", "yaz", "teyin", "deyis", "olmalidir", "edek")
THRESHOLD = ("minimum", "min stok", "min. stok", "hedd", "threshold", "xeberdarliq", "alert", "bildiris")
RELATIVE = ("artir", "azalt", "endir", "qaldir", "increase", "decrease", "reduce", "raise", "lower", "by")
SHOW = ("goster", "show", "axtar", "tap", "find", "list", "hansi", "which", "search", "bax", "sadala")
HOW_MANY = ("ne qeder", "nece ", "neçe", "how many", "how much", "qalib", "qalir", "var mi", "varmi", "movcud", "stokda",
            "anbarda")
TOP = ("en cox satilan", "en cox satan", "en cox gelir", "en cok satan", "most sold", "best sell", "top sell", "top ",
       "gelir", "revenue", "qazanc", "ne satil", "neler satil", "nə satıl", "what sold", "what did we sell", "satislar",
       "satis analitika", "satis statistika", "sales", "dovriyye", "satis hesabat")
UNSOLD = ("satilmayan", "satilmir", "satilmamis", "satilmadi", "not sold", "haven't sold", "havent sold", "unsold",
          "hasn't sold", "slow", "durğun", "durgun", "satilmayib")
SUMMARY = ("xulase", "summary", "umumi", "overview", "veziyyet", "vezziyyet", "nece mehsul", "how many products",
           "inventory value", "inventar deyeri", "inventarin deyeri", "inventarimin", "ne qeder mehsul", "hesabat")
LOW = ("az qalan", "azalan", "low stock", "bitmek uzre", "bitmek", "biten", "bitib", "stokda yox", "out of stock",
       "az olan", "tukenen", "running out", "qurtar")
DELETE = ("sil", "delete", "arxivle", "arxive", "arxivə", "legv et mehsul")
ORDERS = ("sifaris", "order")
QUOTES_SUPPLIER = ("sorgu", "teklif", "quote", "rfq")

QUOTE = ("teklif", "quote", "sorgu", "offer")
SEND = ("gonder", "iste", "send", "request", "al", "ver", "et", "yolla")
COMPARE = ("muqayise", "compare", "karsilastir", "ferq")
SUPPLIERS = ("topdansatici", "supplier", "wholesaler", "satici", "tedarikci", "sirket", "magaza", "anbar")

HELP = {
    "supplier": (
        "Mən inventarınızla işləməyə kömək edirəm. Məsələn yaza bilərsiniz:\n\n"
        "- «Anbarımda 500 taxta qapı və 120 laminat panel var, hər biri 85 AZN»\n"
        "- «Ağ MDF qapının qiymətini 85 AZN et»\n"
        "- «Taxta qapıdan 20 dənə satdım» və ya «Taxta lövhənin sayı 250 olsun»\n"
        "- «Stokda nə qədər taxta qapı var?» / «20 ədəddən az qalan məhsulları göstər»\n"
        "- «Son 3 ayda ən çox gəlir gətirən məhsullar hansılardır?»"
    ),
    "buyer": (
        "Nə axtardığınızı sərbəst yazın, mən real topdansatıcı təkliflərini tapım. Məsələn:\n\n"
        "- «Bakıda 25 ağ MDF qapı lazımdır, ucuz variantları göstər»\n"
        "- «100 kvadrat metr laminat tap»\n"
        "- «MDF lövhə qiymətlərini müqayisə et»\n"
        "- «Birincisinə təklif sorğusu göndər» (axtarışdan sonra)\n"
        "- «Bakıdakı topdansatıcıları göstər»"
    ),
}


def _money_fmt(d: Decimal) -> str:
    return plain(d) or ""


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
def _price_amounts(u: Utterance) -> list[Decimal]:
    if u.money:
        return u.money
    if u.has(*PRICE):
        return [q.value for q in u.quantities if q.unit is None]
    return []


def _is_price_change(u: Utterance) -> bool:
    has_amount = bool(_price_amounts(u))
    stock_qty = [q for q in u.quantities if q.unit] or (u.money and u.quantities)
    return has_amount and not stock_qty and not u.has(*ADD) and not u.has(*STOCK)


def act_price(u: Utterance) -> Plan | None:
    amounts = _price_amounts(u)
    ref = u.ref()
    if not ref:
        return Reply(f"Hansı məhsulun qiymətini {_money_fmt(amounts[0])} ₼ edim? Məhsulun adını da yazın, məsələn: "
                     f"«Taxta qapının qiymətini {_money_fmt(amounts[0])} AZN et».")
    args: dict[str, Any] = {"product": ref}
    m_buy = re.search(rf"(?:alis|maya|purchase|cost price)\D{{0,25}}?({NUM})", u.f)
    m_sell = re.search(rf"(?:satis|selling|sale price)\D{{0,25}}?({NUM})", u.f)
    if m_buy:
        args["purchase_price"] = plain(Decimal(m_buy.group(1).replace(",", ".")))
    if m_sell:
        args["selling_price"] = plain(Decimal(m_sell.group(1).replace(",", ".")))
    if not m_buy and not m_sell:
        args["selling_price"] = plain(amounts[0])
    return [Call("update_price", args)]


def _is_relative_price(u: Utterance) -> bool:
    if not u.has(*PRICE):
        return False
    if u.percent:
        return True
    return bool(_price_amounts(u)) and u.has(*RELATIVE) and not re.search(r"manata|azn-?[ea]\b|\bto\b", u.f)


def act_relative_price(u: Utterance) -> Plan:
    ref = u.ref(extra_drop=RELATIVE) or "məhsulun"
    return Reply(f"Qiymətləri faizlə və ya «… manat artır» kimi nisbi dəyişmirəm, çünki səhv hesablama riski var. "
                 f"Yeni qiyməti dəqiq yazın, məsələn: «{ref} qiymətini 95 AZN et».")


def act_price_ask(u: Utterance) -> Plan:
    ref = u.ref()
    who = f"«{ref}» üçün yeni" if ref else "Yeni"
    return Reply(f"{who} qiyməti yazın, məsələn: «Taxta qapının qiymətini 90 AZN et». "
                 "Alış qiymətini dəyişmək üçün «alış qiyməti» deyin.")


def act_threshold(u: Utterance) -> Plan:
    ref = u.ref()
    n = u.quantities[0].value
    if not ref:
        return Reply(f"Hansı məhsul üçün minimum stok həddini {plain(n)} edim?")
    return [Call("update_product", {"product": ref, "low_stock_threshold": int(n)})]


def act_stock_set(u: Utterance) -> Plan:
    ref = u.ref()
    n = u.quantities[0].value
    if not ref:
        return Reply(f"Hansı məhsulun miqdarını {plain(n)} edim? Məhsulun adını yazın.")
    return [Call("update_inventory", {"product": ref, "set_quantity": plain(n)})]


def act_stock_change(u: Utterance) -> Plan:
    ref = u.ref()
    n = u.quantities[0].value
    sign = "-" if u.has(*DEC) else ""
    if not ref:
        return Reply(f"Hansı məhsulun stokunu {plain(n)} {'azaldım' if sign else 'artırım'}? Məhsulun adını yazın.")
    return [Call("update_inventory", {"product": ref, "change": f"{sign}{plain(n)}", "reason": "AI köməkçi: " + u.raw[:120]})]


def act_analytics_top(u: Utterance) -> Plan:
    if u.has("gelir", "revenue", "qazanc", "pul", "dovriyye", "mebleg"):
        metric = "top_revenue"
    elif u.has("en cox satilan", "en cok satan", "most sold", "best sell", "top sell", "eded", "units", "ne satil",
               "neler satil", "what sold", "what did we sell"):
        metric = "top_units"
    else:
        metric = "top_revenue"
    return [Call("get_sales_analytics", {"metric": metric, "days": u.days})]


def act_low_threshold(u: Utterance) -> Plan | None:
    m = re.search(rf"({NUM})\s*(?:-?(?:den|dan)\s*az|ededden az|vahidden az|deneden az|m2-?den az)", u.f) or \
        re.search(rf"(?:fewer|less|below|under)\s*(?:than)?\s*({NUM})", u.f)
    if not m:
        return None
    return [Call("search_inventory", {"max_quantity": plain(Decimal(m.group(1).replace(",", "."))), "limit": 50})]


def act_add(u: Utterance) -> Plan | None:
    from app.ai.providers.rule_based import parse_inventory_items

    items = parse_inventory_items(u.raw)
    if not items:
        return None
    return [Call("create_product", {k: v for k, v in i.items() if v is not None}) for i in items[:20]]


def act_add_without_quantity(u: Utterance) -> Plan:
    ref = u.ref(use_context=False) or ""
    return Reply(f"«{ref}» məhsulundan neçə ədəd əlavə edim? Miqdarı və mümkünsə qiyməti yazın, məsələn: "
                 f"«Anbarımda 50 {ref.lower()} var, hər biri 85 AZN».")


def act_stock_query(u: Utterance) -> Plan:
    ref = u.ref(use_context=False)
    if not ref:
        return [Call("get_inventory_summary", {})]
    return [Call("search_inventory", {"query": ref, "limit": 10})]


def act_search_inventory(u: Utterance) -> Plan:
    ref = u.ref(extra_drop=("butun", "hamisi", "all", "hamisini", "list"), use_context=False)
    return [Call("search_inventory", {"query": ref, "limit": 30} if ref else {"limit": 30})]


def act_lookup(u: Utterance) -> Plan | None:
    ref = u.ref(use_context=False)
    return [Call("search_inventory", {"query": ref, "limit": 10})] if ref else None


def _quote_targets(u: Utterance) -> list[tuple[str, str]]:
    listings = u.context.listings
    if u.wants_all:
        return listings[:5]
    idx = u.ordinal if u.ordinal is not None else 0
    try:
        return [listings[idx]]
    except IndexError:
        return []


def act_quote(u: Utterance) -> Plan | None:
    if not u.context.listings:
        if u.concepts:
            return None  # a new requirement: search first
        return Reply("Hansı elana sorğu göndərim? Əvvəlcə nə lazım olduğunu yazın, məsələn: "
                     "«Bakıda 25 ağ MDF qapı lazımdır». Sonra «birincisinə təklif göndər» deyə bilərsiniz.")
    if u.concepts and u.ordinal is None and not u.wants_all:
        return None
    targets = _quote_targets(u)
    if not targets:
        return Reply(f"Son axtarışda {len(u.context.listings)} elan var. Hansına göndərim? Məsələn: «birincisinə» və ya «hamısına».")
    qty = plain(u.quantities[0].value) if u.quantities else u.context.quantity
    if not qty:
        names = ", ".join(t for _, t in targets)
        return Reply(f"{names} üçün neçə ədəd (və ya m², kq) təklif istəyirsiniz? Məsələn: «25 ədəd üçün təklif göndər».")
    return [Call("create_quote_request", {"listing_ids": [i for i, _ in targets], "quantity": qty})]


def act_compare_context(u: Utterance) -> Plan | None:
    if not u.context.listings or u.concepts:
        return None
    args: dict[str, Any] = {"listing_ids": [i for i, _ in u.context.listings[:5]]}
    if u.context.quantity:
        args["quantity"] = u.context.quantity
    return [Call("compare_offers", args)]


def act_compare_query(u: Utterance) -> Plan:
    q = u.ref(extra_drop=COMPARE + ("et", "teklif"))
    if not q:
        return Reply("Nəyin qiymətlərini müqayisə edim? Məsələn: «MDF lövhə qiymətlərini müqayisə et».")
    args: dict[str, Any] = {"query": q}
    if u.quantities:
        args["quantity"] = plain(u.quantities[0].value)
    return [Call("compare_offers", args)]


def act_find_suppliers(u: Utterance) -> Plan:
    return [Call("find_suppliers", {"city": u.city} if u.city else {})]


def act_search_market(u: Utterance) -> Plan | None:
    if not u.concepts and not u.rest:
        return None
    return [Call("search_marketplace", {"query": u.raw[:300]})]


# ---------------------------------------------------------------------------
# The rule table
# ---------------------------------------------------------------------------
L1 = "11111111-1111-4111-8111-111111111111"
L2 = "22222222-2222-4222-8222-222222222222"
SEARCH_CTX = (f"Tələbinizə uyğun 2 təklif tapdım.\n[context: listing_id={L1} title=Ağ MDF qapı; "
              f"listing_id={L2} title=Taxta qapı; quantity=25]")
PRODUCT_CTX = "İnventarınızda 1 uyğun məhsul tapdım.\n[context: product=Taxta qapı]"

RULES: list[Rule] = [
    # ---- small talk (both modes)
    Rule("common.greeting", "any", 100,
         "mesaj yalnız salamlaşmadır (salam, necəsən, hello) və heç bir sorğu yoxdur",
         "alət çağırma; qısa salamlaş və nə edə biləcəyini 3–5 nümunə ilə göstər",
         lambda u: u.only(GREET | FILLER) and any(t in GREET for t in u.tokens),
         lambda u: Reply("Salam! " + HELP[u.mode]),
         (ex("Salam", reply="Salam!"), ex("Necəsən?", reply="Salam!"))),
    Rule("common.thanks", "any", 100,
         "istifadəçi təşəkkür edir və ya «oldu/tamam» deyir",
         "alət çağırma; qısa cavab ver: «Buyurun! Başqa nə ilə kömək edim?»",
         lambda u: u.only(THANKS | GREET | FILLER) and any(t in THANKS for t in u.tokens),
         lambda u: Reply("Buyurun! Başqa nə ilə kömək edim?"),
         (ex("Sağ ol", reply="Buyurun"), ex("Çox təşəkkür edirəm, oldu", reply="Buyurun"))),
    Rule("common.capabilities", "any", 99,
         "istifadəçi nə edə bildiyini, necə işlədiyini soruşur",
         "alət çağırma; bacarıqlarını konkret nümunələrlə sadala",
         lambda u: u.has(*CAPABILITY) and not u.numbers and not u.concepts,
         lambda u: Reply(HELP[u.mode]),
         (ex("Nə edə bilirsən?", reply="Məsələn"),)),

    # ---- supplier
    Rule("supplier.delete", "supplier", 95,
         "məhsulu silmək/arxivləmək istəyir",
         "alət çağırma; bunu köməkçinin etmədiyini və Inventar səhifəsindəki «Arxivlə» əmrini göstər",
         lambda u: u.has(*DELETE) and not u.numbers,
         lambda u: Reply("Məhsulları köməkçi silmir — geri qaytarılmaz səhvlərin qarşısını almaq üçün. **Inventar** "
                         "səhifəsində məhsulun sətirindəki menyudan **Arxivlə** seçin (arxivi geri qaytarmaq olur)."),
         (ex("Taxta qapını sil", reply="Arxivlə"),)),
    Rule("supplier.threshold", "supplier", 90,
         "minimum stok həddini / xəbərdarlıq həddini dəyişmək istəyir və rəqəm var",
         "update_product çağır: product = məhsulun adı, low_stock_threshold = rəqəm",
         lambda u: u.has(*THRESHOLD) and bool(u.quantities),
         act_threshold,
         (ex("Taxta qapının minimum stokunu 30 et", ("update_product", {"product": "Taxta qapı", "low_stock_threshold": 30})),)),
    Rule("supplier.price.relative", "supplier", 88,
         "qiyməti faizlə və ya «10 manat artır» kimi nisbi dəyişmək istəyir",
         "alət çağırma; yeni qiyməti dəqiq rəqəmlə yazmağı xahiş et (cari qiyməti təxmin etmə)",
         _is_relative_price,
         act_relative_price,
         (ex("Taxta qapının qiymətini 10% artır", reply="dəqiq"),
          ex("Laminatın qiymətini 5 manat endir", reply="dəqiq", prompt=False))),
    Rule("supplier.analytics.unsold", "supplier", 86,
         "satılmayan / durğun məhsulları soruşur",
         "get_sales_analytics çağır: metric=\"unsold\", days = istədiyi dövr (susmaya görə 30)",
         lambda u: u.has(*UNSOLD),
         lambda u: [Call("get_sales_analytics", {"metric": "unsold", "days": u.days})],
         (ex("Hansı məhsullar son 2 həftədə satılmayıb?", ("get_sales_analytics", {"metric": "unsold", "days": 14})),)),
    Rule("supplier.analytics.top", "supplier", 85,
         "satış, gəlir, ən çox satılan məhsullar haqqında soruşur",
         "get_sales_analytics çağır: gəlir soruşursa metric=\"top_revenue\", say soruşursa \"top_units\"; "
         "days: «bu həftə»=7, «bu ay»=30, «son 3 ay»=90, «bu il»=365. Rəqəmləri yalnız nəticədən götür",
         lambda u: u.has(*TOP) and not (u.has(*DEC) and u.quantities),
         act_analytics_top,
         (ex("Bu ay ən çox gəlir gətirən məhsullar hansılardır?", ("get_sales_analytics", {"metric": "top_revenue", "days": 30})),
          ex("Son 3 ayda ən çox satılan məhsul", ("get_sales_analytics", {"metric": "top_units", "days": 90})),
          ex("Bu həftə nə satılıb?", ("get_sales_analytics", {"metric": "top_units", "days": 7})))),
    Rule("supplier.summary", "supplier", 80,
         "inventarın ümumi vəziyyətini, dəyərini, məhsul sayını soruşur",
         "get_inventory_summary çağır",
         lambda u: u.has(*SUMMARY) and not u.quantities,
         lambda u: [Call("get_inventory_summary", {})],
         (ex("İnventarımın ümumi dəyəri nə qədərdir?", ("get_inventory_summary", {})),
          ex("İnventar xülasəsi", ("get_inventory_summary", {}), prompt=False))),
    Rule("supplier.orders", "supplier", 78,
         "sifarişlər və ya alıcı sorğuları haqqında soruşur (köməkçinin bunun üçün aləti yoxdur)",
         "alət çağırma; «Sifarişlər» və «Sorğular və təkliflər» səhifələrini göstər, uydurma sifariş sadalama",
         lambda u: u.has(*ORDERS, *QUOTES_SUPPLIER) and not u.numbers,
         lambda u: Reply("Sifarişləri **Sifarişlər**, alıcı sorğularını isə **Sorğular və təkliflər** səhifəsində görə və "
                         "cavablandıra bilərsiniz. Köməkçi hələ sifarişləri idarə etmir."),
         (ex("Yeni sifariş var?", reply="Sifarişlər"),)),
    Rule("supplier.lowstock.threshold", "supplier", 75,
         "«N ədəddən az qalan» məhsulları soruşur",
         "search_inventory çağır: max_quantity = N",
         lambda u: bool(u.quantities) and u.has("az", "fewer", "less", "below", "under"),
         act_low_threshold,
         (ex("20 ədəddən az qalan məhsulları göstər", ("search_inventory", {"max_quantity": "20", "limit": 50})),)),
    Rule("supplier.lowstock", "supplier", 74,
         "bitmək üzrə olan / stoku az məhsulları soruşur",
         "search_inventory çağır: stock_status=\"attention\"",
         lambda u: u.has(*LOW),
         lambda u: [Call("search_inventory", {"stock_status": "attention", "limit": 50})],
         (ex("Hansı məhsullar bitmək üzrədir?", ("search_inventory", {"stock_status": "attention", "limit": 50})),)),
    Rule("supplier.stock.change", "supplier", 70,
         "mövcud məhsulun stokunu artırmaq/azaltmaq istəyir (satdım, azalt, artır, xarab oldu) və miqdar var",
         "update_inventory çağır: product = məhsulun adı, change = işarəli miqdar (azalanda mənfi), reason = istifadəçinin sözləri",
         lambda u: (u.has(*DEC) or u.has(*INC)) and bool(u.quantities) and not u.has(*PRICE),
         act_stock_change,
         (ex("Taxta qapıdan 20 dənə satdım", ("update_inventory", {"product": "Taxta qapı", "change": "-20",
                                                                  "reason": "AI köməkçi: Taxta qapıdan 20 dənə satdım"})),
          ex("Laminat paneli 15 ədəd artır", ("update_inventory", {"product": "Laminat panel", "change": "15",
                                                                 "reason": "AI köməkçi: Laminat paneli 15 ədəd artır"})),
          ex("Reduce the stock of white MDF door by 40 units",
             ("update_inventory", {"product": "white MDF door", "change": "-40",
                                   "reason": "AI köməkçi: Reduce the stock of white MDF door by 40 units"}), prompt=False))),
    Rule("supplier.stock.set", "supplier", 68,
         "mövcud məhsulun miqdarını konkret rəqəmə bərabər etmək istəyir («sayı 250 olsun»)",
         "update_inventory çağır: product = məhsulun adı, set_quantity = rəqəm",
         lambda u: bool(u.quantities) and not u.money and u.has(*SET) and (u.has(*STOCK) or u.has("olsun", "olmalidir"))
         and not u.has(*ADD),
         act_stock_set,
         (ex("Taxta lövhənin sayı 250 olsun", ("update_inventory", {"product": "Taxta lövhə", "set_quantity": "250"})),
          ex("Onun stokunu 120 et", ("update_inventory", {"product": "Taxta qapı", "set_quantity": "120"}),
             context=PRODUCT_CTX))),
    Rule("supplier.price.set", "supplier", 65,
         "mövcud məhsulun qiymətini dəyişir: məbləğ (manat/AZN) və ya «qiymət» sözü + rəqəm var, miqdar yoxdur",
         "update_price çağır: product = məhsulun adı, selling_price = məbləğ; «alış»/«maya» deyilibsə purchase_price",
         _is_price_change,
         act_price,
         (ex("Taxta qapı 90 manat olsun", ("update_price", {"product": "Taxta qapı", "selling_price": "90"})),
          ex("Taxta qapının qiymətini 90 manata qaldır", ("update_price", {"product": "Taxta qapı", "selling_price": "90"})),
          ex("Ağ MDF qapının alış qiyməti 60 manatdır", ("update_price", {"product": "Ağ MDF qapı", "purchase_price": "60"})),
          ex("Onun qiymətini 95 AZN et", ("update_price", {"product": "Taxta qapı", "selling_price": "95"}),
             context=PRODUCT_CTX),
          ex("Qiyməti 85 manat et", reply="Hansı məhsulun", prompt=False))),
    Rule("supplier.price.ask", "supplier", 60,
         "qiyməti dəyişmək istəyir, amma yeni qiymət yazılmayıb",
         "alət çağırma; yeni qiyməti soruş",
         lambda u: u.has(*PRICE) and u.has("deyis", "yenile", "change", "update", "set", "teyin", "et", "qaldir", "endir")
         and not u.numbers,
         act_price_ask,
         (ex("Qiyməti dəyiş", reply="qiyməti yazın"),)),
    Rule("supplier.stock.query", "supplier", 55,
         "konkret məhsulun stokda nə qədər olduğunu soruşur",
         "search_inventory çağır: query = məhsulun adı; cavabda yalnız nəticədəki miqdarı de",
         lambda u: u.has(*HOW_MANY) and not u.quantities and not u.money and not u.has(*ADD[:4]),
         act_stock_query,
         (ex("Stokda nə qədər taxta qapı var?", ("search_inventory", {"query": "taxta qapı", "limit": 10})),
          ex("Taxta qapı neçə dənədir?", ("search_inventory", {"query": "Taxta qapı", "limit": 10})))),
    Rule("supplier.inventory.add", "supplier", 50,
         "anbara mal əlavə edir / anbarda nə olduğunu sadalayır (miqdar var)",
         "hər məhsul üçün ayrıca create_product çağır: name, quantity, unit, və deyilibsə selling_price/purchase_price. "
         "«Hər biri 85 AZN» bütün məhsullara aiddir. Qiymət deyilməyibsə, qiymət uydurma",
         lambda u: bool(u.quantities),
         act_add,
         (ex("Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN",
             ("create_product", {"name": "Taxta qapı", "quantity": "500", "unit": "piece", "selling_price": "85"}),
             ("create_product", {"name": "Taxta lövhə", "quantity": "300", "unit": "piece", "selling_price": "85"}),
             ("create_product", {"name": "Laminat panel", "quantity": "120", "unit": "piece", "selling_price": "85"})),
          ex("500 ədəd ağ MDF qapı əlavə et, qiyməti 85 manat",
             ("create_product", {"name": "Ağ MDF qapı", "quantity": "500", "unit": "piece", "selling_price": "85",
                                 "color": "white"})),
          ex("Bu gün 40 laminat panel gəldi", ("create_product", {"name": "Laminat panel", "quantity": "40", "unit": "piece"})),
          ex("200 kv.m laminat 12 manat", ("create_product", {"name": "Laminat", "quantity": "200", "unit": "m2",
                                                              "selling_price": "12"}), prompt=False))),
    Rule("supplier.inventory.add_noqty", "supplier", 48,
         "məhsul əlavə etmək istəyir, amma miqdar yazılmayıb",
         "alət çağırma; miqdarı (və qiyməti) soruş, miqdar uydurma",
         lambda u: u.has("elave", "add") and not u.numbers and bool(u.ref(use_context=False)),
         act_add_without_quantity,
         (ex("Taxta qapı əlavə et", reply="neçə ədəd"),)),
    Rule("supplier.inventory.search", "supplier", 40,
         "öz inventarında məhsul axtarır və ya siyahı istəyir",
         "search_inventory çağır: query = axtarılan söz (hamısı istənirsə query vermə)",
         lambda u: u.has(*SHOW),
         act_search_inventory,
         (ex("Bütün məhsulları göstər", ("search_inventory", {"limit": 30})),
          ex("MDF qapıları göstər", ("search_inventory", {"query": "MDF qapı", "limit": 30})))),
    Rule("supplier.lookup", "supplier", 20,
         "yalnız məhsul adı yazılıb (məs. «qapı»)",
         "search_inventory çağır: query = həmin ad",
         lambda u: not u.numbers and bool(u.concepts or u.rest),
         act_lookup,
         (ex("taxta qapı", ("search_inventory", {"query": "taxta qapı", "limit": 10})),)),

    # ---- buyer
    Rule("buyer.quote.followup", "buyer", 90,
         "axtarışdan sonra təklif sorğusu göndərmək istəyir («birincisinə təklif göndər», «hamısından qiymət istə»)",
         "create_quote_request çağır: listing_ids YALNIZ əvvəlki nəticələrdəki listing_id-lərdən (birinci=1-ci nəticə), "
         "quantity = deyilən miqdar və ya əvvəlki axtarışdakı miqdar; miqdar bilinmirsə soruş",
         lambda u: u.has(*QUOTE) and u.has(*SEND),
         act_quote,
         (ex("Birincisinə təklif göndər", ("create_quote_request", {"listing_ids": [L1], "quantity": "25"}),
             context=SEARCH_CTX),
          ex("Hamısından 40 ədəd üçün təklif istə", ("create_quote_request", {"listing_ids": [L1, L2], "quantity": "40"}),
             context=SEARCH_CTX),
          ex("İkincisinə sorğu göndər", ("create_quote_request", {"listing_ids": [L2], "quantity": "25"}),
             context=SEARCH_CTX, prompt=False),
          ex("Təklif göndər", reply="Əvvəlcə"))),
    Rule("buyer.compare.context", "buyer", 85,
         "əvvəlki nəticələri müqayisə etmək istəyir (məhsul adı yazmadan)",
         "compare_offers çağır: listing_ids = əvvəlki nəticələrin id-ləri",
         lambda u: u.has(*COMPARE),
         act_compare_context,
         (ex("Bunları müqayisə et", ("compare_offers", {"listing_ids": [L1, L2], "quantity": "25"}), context=SEARCH_CTX),)),
    Rule("buyer.compare.query", "buyer", 84,
         "konkret məhsulun qiymətlərini müqayisə etmək istəyir",
         "compare_offers çağır: query = məhsulun adı",
         lambda u: u.has(*COMPARE),
         act_compare_query,
         (ex("MDF lövhə qiymətlərini müqayisə et", ("compare_offers", {"query": "MDF lövhə"})),)),
    Rule("buyer.suppliers", "buyer", 80,
         "topdansatıcıları (şəhər üzrə) soruşur, məhsul adı yoxdur",
         "find_suppliers çağır: city = şəhər (varsa)",
         lambda u: u.has(*SUPPLIERS) and not u.concepts,
         act_find_suppliers,
         (ex("Gəncədə topdansatıcı var?", ("find_suppliers", {"city": "Gəncə"})),
          ex("Bakıdakı topdansatıcıları göstər", ("find_suppliers", {"city": "Bakı"}), prompt=False))),
    Rule("buyer.orders", "buyer", 70,
         "öz sifarişləri və ya sorğuları haqqında soruşur",
         "alət çağırma; «Sifarişlərim» və «Sorğularım» səhifələrini göstər",
         lambda u: u.has("sifaris", "order", "sorgularim", "tekliflerim") and not u.concepts and not u.numbers,
         lambda u: Reply("Sifarişlərinizi **Sifarişlər**, göndərdiyiniz sorğuları və gələn təklifləri isə **Təkliflər** "
                         "səhifəsində görə bilərsiniz."),
         (ex("Sifarişlərim haradadır?", reply="Sifarişlər"),)),
    Rule("buyer.search", "buyer", 50,
         "nə lazım olduğunu yazır (məhsul, miqdar, şəhər, qiymət həddi)",
         "search_marketplace çağır: query = istifadəçinin öz sözləri; yalnız nəticədəki elanları təqdim et, heç nə uydurma",
         lambda u: True,
         act_search_market,
         (ex("Bakıda 25 ağ MDF qapı lazımdır", ("search_marketplace", {"query": "Bakıda 25 ağ MDF qapı lazımdır"})),
          ex("ən ucuz sement hansıdır?", ("search_marketplace", {"query": "ən ucuz sement hansıdır?"})))),
]
RULES.sort(key=lambda r: -r.priority)

FALLBACK = "Bunu tam başa düşmədim. "
_CLAUSES = re.compile(r"\s+(?:və|ve|and|sonra|həm də|hem de)\s+|;|,(?!\d)", re.IGNORECASE)
_CHAINABLE = {"update_price", "update_inventory", "update_product"}


def rules_for(mode: str) -> list[Rule]:
    return [r for r in RULES if r.mode in (mode, "any")]


def _first(u: Utterance) -> tuple[Plan, Rule | None]:
    for rule in rules_for(u.mode):
        if rule.match(u):
            result = rule.act(u)
            if result is not None:
                return result, rule
    return Reply(FALLBACK + HELP[u.mode]), None


def _chained(text: str, mode: str, context: Context) -> tuple[list[Call], Rule | None]:
    """Several edits in one message ("Taxta qapının qiymətini 90 et və stokunu 20 azalt"): plan each clause;
    a clause without a product name refers to the product of the previous clause."""
    clauses = [c for c in _CLAUSES.split(text) if c and c.strip()]
    if len(clauses) < 2:
        return [], None
    ctx = Context(listings=context.listings, products=list(context.products), quantity=context.quantity)
    calls: list[Call] = []
    first_rule = None
    for clause in clauses:
        result, rule = _first(Utterance(clause, ctx, mode))
        if not isinstance(result, list) or any(c.tool not in _CHAINABLE for c in result):
            return [], None
        first_rule = first_rule or rule
        calls += result
        ctx.products.append(result[-1].args["product"])
    return calls, first_rule


def plan(text: str, mode: str, context: Context | None = None) -> tuple[Plan, Rule | None]:
    """Return the plan for one message and the rule that produced it (None = fallback help)."""
    context = context or Context()
    calls, rule = _chained(text, mode, context)
    if calls:
        return calls, rule
    return _first(Utterance(text, context, mode))


# extra multi-command example (asserted in tests, shown to the LLM)
MULTI_EXAMPLE = ex("Taxta qapının qiymətini 90 manat et və stokunu 20 azalt",
                   ("update_price", {"product": "Taxta qapı", "selling_price": "90"}),
                   ("update_inventory", {"product": "Taxta qapı", "change": "-20",
                                         "reason": "AI köməkçi: stokunu 20 azalt"}))
