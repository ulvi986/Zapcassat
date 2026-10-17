"""Public marketplace: listings management, catalogue browsing and requirement-based search/ranking.

Only data from marketplace_listings (+ public supplier fields and, when the supplier allows it,
available stock) ever leaves this module. Purchase prices and private inventory never do."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFound, ValidationFailed
from app.models import Business, Inventory, MarketplaceListing, Product, ProductCategory
from app.models.entities import LISTING_STATUSES, UNITS
from app.services.common import audit, iso, money, money_str, qty, qty_str, utc_now
from app.services.lexicon import (
    COLOR_CONCEPTS,
    MATERIAL_CONCEPTS,
    analyze,
    build_search_text,
    detect_city,
    fold,
    parse_unit,
    unit_phrase_replace,
)

MODIFIER_CONCEPTS = COLOR_CONCEPTS | MATERIAL_CONCEPTS | {"interior", "exterior", "waterproof"}


# ---------------------------------------------------------------------------
# Supplier-side listing management
# ---------------------------------------------------------------------------
def _listing_search_text(listing: MarketplaceListing, product: Product, category: ProductCategory | None) -> str:
    attrs = " ".join(str(v) for v in (product.attributes or {}).values())
    # Category names are deliberately excluded: "Qapı və pəncərələr" would make every door match "window".
    return build_search_text(listing.title, listing.description, product.name, attrs)


def upsert_listing(db: Session, *, actor_id: uuid.UUID, business: Business, product: Product, data: dict[str, Any]) -> MarketplaceListing:
    listing = db.scalar(select(MarketplaceListing).where(MarketplaceListing.product_id == product.id))
    creating = listing is None
    if creating:
        price = data.get("price") if data.get("price") is not None else product.selling_price
        if price is None:
            raise ValidationFailed("Elan üçün qiymət tələb olunur (məhsulun satış qiymətini daxil edin)", details={"field": "price"})
        listing = MarketplaceListing(business_id=business.id, product_id=product.id, title=product.name,
                                     price=money(price), unit=product.unit, city=business.city,
                                     category_id=product.category_id, description=product.description)
        db.add(listing)
    before = None if creating else {"price": listing.price, "status": listing.status, "title": listing.title}
    if "title" in data and data["title"]:
        listing.title = data["title"].strip()[:250]
    if "description" in data:
        listing.description = data["description"]
    if data.get("price") is not None:
        listing.price = money(data["price"])
        if listing.price < 0:
            raise ValidationFailed("Qiymət mənfi ola bilməz")
    if data.get("min_order_qty") is not None:
        moq = qty(data["min_order_qty"])
        if moq <= 0:
            raise ValidationFailed("Minimum sifariş miqdarı müsbət olmalıdır")
        listing.min_order_qty = moq
    if data.get("show_stock") is not None:
        listing.show_stock = bool(data["show_stock"])
    if data.get("city") is not None:
        listing.city = data["city"] or business.city
    if data.get("status") is not None:
        if data["status"] not in LISTING_STATUSES:
            raise ValidationFailed("Naməlum status")
        listing.status = data["status"]
    if listing.status == "active" and product.is_archived:
        raise ValidationFailed("Arxivlənmiş məhsul üçün aktiv elan ola bilməz")
    if listing.status == "active" and listing.published_at is None:
        listing.published_at = utc_now()
    listing.unit = product.unit
    listing.category_id = product.category_id
    category = db.get(ProductCategory, product.category_id) if product.category_id else None
    listing.search_text = _listing_search_text(listing, product, category)
    db.flush()
    audit(db, business_id=business.id, actor_id=actor_id, action="listing.create" if creating else "listing.update",
          entity_type="listing", entity_id=listing.id, before=before,
          after={"price": listing.price, "status": listing.status, "title": listing.title})
    return listing


def get_business_listing(db: Session, business_id: uuid.UUID, listing_id: uuid.UUID) -> MarketplaceListing:
    listing = db.scalar(select(MarketplaceListing).where(MarketplaceListing.id == listing_id,
                                                         MarketplaceListing.business_id == business_id))
    if listing is None:
        raise NotFound("Elan tapılmadı")
    return listing


def list_business_listings(db: Session, business_id: uuid.UUID) -> list[dict]:
    rows = db.scalars(
        select(MarketplaceListing).where(MarketplaceListing.business_id == business_id)
        .options(selectinload(MarketplaceListing.product).selectinload(Product.inventory),
                 selectinload(MarketplaceListing.product).selectinload(Product.images),
                 selectinload(MarketplaceListing.business), selectinload(MarketplaceListing.category))
        .order_by(MarketplaceListing.updated_at.desc())
    ).all()
    out = []
    for l in rows:
        d = serialize_listing(l)
        d["product_id"] = str(l.product_id)
        d["product_name"] = l.product.name
        d["private_quantity"] = qty_str(l.product.inventory.quantity if l.product.inventory else 0)
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Public catalogue
# ---------------------------------------------------------------------------
def _public_base():
    return (
        select(MarketplaceListing)
        .join(Product, Product.id == MarketplaceListing.product_id)
        .join(Business, Business.id == MarketplaceListing.business_id)
        .where(MarketplaceListing.status == "active", Product.is_archived.is_(False))
        .options(selectinload(MarketplaceListing.product).selectinload(Product.inventory),
                 selectinload(MarketplaceListing.product).selectinload(Product.images),
                 selectinload(MarketplaceListing.business), selectinload(MarketplaceListing.category))
    )


def available_quantity(listing: MarketplaceListing) -> Decimal:
    inv = listing.product.inventory
    if inv is None:
        return Decimal(0)
    return max(Decimal(inv.quantity) - Decimal(inv.reserved), Decimal(0))


def serialize_listing(l: MarketplaceListing) -> dict[str, Any]:
    avail = available_quantity(l)
    images = l.product.images if l.product else []
    return {
        "id": str(l.id),
        "title": l.title,
        "description": l.description,
        "price": money_str(l.price),
        "currency": l.currency,
        "unit": l.unit,
        "min_order_qty": qty_str(l.min_order_qty),
        "available_quantity": qty_str(avail) if l.show_stock else None,
        "in_stock": avail > 0,
        "status": l.status,
        "city": l.city,
        "image_url": images[0].url if images else None,
        "images": [i.url for i in images],
        "category": {"id": str(l.category.id), "name_az": l.category.name_az, "slug": l.category.slug} if l.category else None,
        "attributes": (l.product.attributes or {}) if l.product else {},
        "supplier": {"id": str(l.business.id), "name": l.business.name, "slug": l.business.slug, "city": l.business.city,
                     "verified": l.business.verified},
        "published_at": iso(l.published_at),
    }


def get_public_listing(db: Session, listing_id: uuid.UUID) -> MarketplaceListing:
    listing = db.scalar(_public_base().where(MarketplaceListing.id == listing_id))
    if listing is None:
        raise NotFound("Məhsul tapılmadı və ya artıq satışda deyil")
    return listing


def _text_filter(stmt, q: str):
    concepts, rest = analyze(q)
    terms = [f"#{c}" for c in concepts] + rest
    if not terms:
        terms = [fold(q)]
    return stmt.where(or_(*[MarketplaceListing.search_text.ilike(f"%{t}%") for t in terms]))


def browse(db: Session, *, q: str | None = None, category: str | None = None, city: str | None = None,
           min_price: Decimal | None = None, max_price: Decimal | None = None, supplier: str | None = None,
           in_stock: bool = False, sort: str = "newest", page: int = 1, page_size: int = 24) -> dict[str, Any]:
    stmt = _public_base()
    if q:
        stmt = _text_filter(stmt, q)
    if category:
        stmt = stmt.join(ProductCategory, ProductCategory.id == MarketplaceListing.category_id).where(ProductCategory.slug == category)
    if city:
        stmt = stmt.where(MarketplaceListing.city == city)
    if supplier:
        stmt = stmt.where(Business.slug == supplier)
    if min_price is not None:
        stmt = stmt.where(MarketplaceListing.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(MarketplaceListing.price <= max_price)
    if in_stock:
        stmt = stmt.join(Inventory, Inventory.product_id == Product.id).where(Inventory.quantity > Inventory.reserved)
    total = db.scalar(select(func.count()).select_from(stmt.with_only_columns(MarketplaceListing.id).subquery())) or 0
    order = {
        "price_asc": MarketplaceListing.price.asc(),
        "price_desc": MarketplaceListing.price.desc(),
        "newest": MarketplaceListing.published_at.desc(),
    }.get(sort, MarketplaceListing.published_at.desc())
    page_size = max(1, min(page_size, 60))
    items = db.scalars(stmt.order_by(order, MarketplaceListing.id).offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
    return {"items": [serialize_listing(l) for l in items], "total": total, "page": page, "page_size": page_size}


def list_cities(db: Session) -> list[str]:
    rows = db.scalars(
        select(MarketplaceListing.city).where(MarketplaceListing.status == "active", MarketplaceListing.city.is_not(None)).distinct()
    ).all()
    return sorted(c for c in rows if c)


def list_suppliers(db: Session, *, city: str | None = None, q: str | None = None, limit: int = 50) -> list[dict]:
    stmt = (
        select(Business, func.count(MarketplaceListing.id))
        .join(MarketplaceListing, MarketplaceListing.business_id == Business.id)
        .where(Business.kind == "supplier", MarketplaceListing.status == "active")
        .group_by(Business.id)
        .order_by(func.count(MarketplaceListing.id).desc())
        .limit(limit)
    )
    if city:
        stmt = stmt.where(Business.city == city)
    if q:
        stmt = stmt.where(Business.name.ilike(f"%{q}%"))
    return [{**_public_business(b), "active_listings": n} for b, n in db.execute(stmt).all()]


def _public_business(b: Business) -> dict:
    return {"id": str(b.id), "name": b.name, "slug": b.slug, "city": b.city, "description": b.description,
            "verified": b.verified, "phone": b.phone, "address": b.address, "member_since": iso(b.created_at)}


def get_supplier(db: Session, slug: str) -> dict:
    b = db.scalar(select(Business).where(Business.slug == slug, Business.kind == "supplier"))
    if b is None:
        raise NotFound("Topdansatıcı tapılmadı")
    listings = browse(db, supplier=slug, page_size=60)
    return {**_public_business(b), "listings": listings["items"], "active_listings": listings["total"]}


# ---------------------------------------------------------------------------
# Requirement parsing & ranking ("I need 40 white doors near Baku")
# ---------------------------------------------------------------------------
@dataclass
class Criteria:
    text: str
    nouns: list[str] = field(default_factory=list)
    modifiers: list[str] = field(default_factory=list)
    terms: list[str] = field(default_factory=list)
    quantity: Decimal | None = None
    unit: str | None = None
    city: str | None = None
    max_price: Decimal | None = None
    prefer_cheap: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {"text": self.text, "product_types": self.nouns, "attributes": self.modifiers, "keywords": self.terms,
                "quantity": qty_str(self.quantity), "unit": self.unit, "city": self.city,
                "max_price": money_str(self.max_price), "prefer_cheap": self.prefer_cheap}


_CHEAP_WORDS = ("ucuz", "serfeli", "affordable", "cheap", "budget", "uygun fiyat", "ekonom", "en ucuz", "lowest price")
_NUM = r"(\d+(?:[.,]\d+)?)"


def parse_requirement(text: str) -> Criteria:
    folded = unit_phrase_replace(fold(text))
    concepts, rest = analyze(text)
    c = Criteria(text=text.strip())
    c.nouns = sorted(x for x in concepts if x not in MODIFIER_CONCEPTS)
    c.modifiers = sorted(x for x in concepts if x in MODIFIER_CONCEPTS)
    c.terms = rest
    c.city = detect_city(text)
    c.prefer_cheap = any(w in folded for w in _CHEAP_WORDS)
    # price ceiling: "100 manatdan ucuz", "max 100 azn", "under 100 azn", "100 azn-e qeder"
    m = re.search(rf"(?:max(?:imum)?|under|below|en cox|ucuz)\s*{_NUM}\s*(?:azn|manat|m\b)?", folded) or \
        re.search(rf"{_NUM}\s*(?:azn|manat)\s*(?:-?(?:dan|den)\s*(?:ucuz|asagi|az)|-?(?:e|a)\s*qeder)", folded)
    price_span = None
    if m:
        c.max_price = money(m.group(1))
        price_span = m.span(1)
    # quantity: first number not used as price; optional unit right after it
    for qm in re.finditer(rf"{_NUM}\s*([a-z0-9.]+)?", folded):
        if price_span and qm.span(1) == price_span:
            continue
        nxt = qm.group(2) or ""
        if re.match(r"(azn|manat)", nxt):
            continue
        if re.fullmatch(r"\d+x\d+", qm.group(0).replace(" ", "")):
            continue
        c.quantity = qty(qm.group(1))
        c.unit = parse_unit(nxt) if nxt else None
        break
    return c


def rank_listings(db: Session, criteria: Criteria, *, limit: int = 12) -> dict[str, Any]:
    keys = [f"#{n}" for n in criteria.nouns] + [f"#{m}" for m in criteria.modifiers] + criteria.terms
    stmt = _public_base()
    if keys:
        stmt = stmt.where(or_(*[MarketplaceListing.search_text.ilike(f"%{k}%") for k in keys]))
    if criteria.max_price is not None:
        stmt = stmt.where(MarketplaceListing.price <= criteria.max_price)
    candidates = db.scalars(stmt.limit(300)).all() if keys else []

    scored = []
    for l in candidates:
        tokens = set(l.search_text.split())
        noun_hits = [n for n in criteria.nouns if f"#{n}" in tokens]
        if criteria.nouns and not noun_hits:
            continue  # wrong product type (e.g. white paint for "white door")
        mod_hits = [m for m in criteria.modifiers if f"#{m}" in tokens]
        term_hits = [t for t in criteria.terms if any(t in tok for tok in tokens)]
        if not criteria.nouns and not mod_hits and not term_hits:
            continue
        relevance = (40 if criteria.nouns else 20) + (25 * len(mod_hits) / len(criteria.modifiers) if criteria.modifiers else 25)
        relevance += min(10, 5 * len(term_hits))
        scored.append([l, relevance, mod_hits])
    if not scored:
        return {"criteria": criteria.as_dict(), "results": [], "alternatives": _alternatives(db, criteria)}

    prices = [Decimal(l.price) for l, *_ in scored]
    pmin, pmax = min(prices), max(prices)
    results = []
    for l, relevance, mod_hits in scored:
        reasons: list[str] = []
        score = relevance
        avail = available_quantity(l)
        stock_ok: bool | None = None
        if criteria.quantity is not None:
            if l.show_stock:
                stock_ok = avail >= criteria.quantity
                if stock_ok:
                    score += 12
                    reasons.append("stock_sufficient")
                elif avail > 0:
                    score += 2
                    reasons.append("stock_partial")
                else:
                    score -= 15
                    reasons.append("out_of_stock")
            else:
                reasons.append("stock_on_request")
            if criteria.quantity < Decimal(l.min_order_qty):
                score -= 8
                reasons.append("below_moq")
        elif l.show_stock and avail <= 0:
            score -= 15
            reasons.append("out_of_stock")
        cheapness = float((pmax - Decimal(l.price)) / (pmax - pmin)) if pmax > pmin else 1.0
        score += cheapness * (18 if criteria.prefer_cheap else 8)
        if Decimal(l.price) == pmin and len(scored) > 1:
            reasons.append("cheapest")
        if criteria.city:
            if l.city == criteria.city:
                score += 10
                reasons.append("same_city")
            else:
                reasons.append("other_city")
        if criteria.modifiers and len(mod_hits) == len(criteria.modifiers):
            reasons.append("attributes_match")
        exact = (not criteria.modifiers or len(mod_hits) == len(criteria.modifiers))
        total = (Decimal(l.price) * criteria.quantity).quantize(Decimal("0.01")) if criteria.quantity else None
        results.append({
            "listing": serialize_listing(l),
            "score": round(score, 1),
            "match": "exact" if exact else "partial",
            "reasons": reasons,
            "stock_ok": stock_ok,
            "estimated_total": money_str(total),
        })
    results.sort(key=lambda r: -r["score"])
    return {"criteria": criteria.as_dict(), "results": results[:limit], "alternatives": [] if results else _alternatives(db, criteria)}


def _alternatives(db: Session, criteria: Criteria) -> list[dict]:
    """When nothing matches exactly, show same-type products ignoring attributes/city/price, if any exist."""
    if not criteria.nouns:
        return []
    stmt = _public_base().where(or_(*[MarketplaceListing.search_text.ilike(f"%#{n}%") for n in criteria.nouns]))
    return [serialize_listing(l) for l in db.scalars(stmt.order_by(MarketplaceListing.price.asc()).limit(6)).all()]


def smart_search(db: Session, text: str, *, overrides: dict[str, Any] | None = None, limit: int = 12) -> dict[str, Any]:
    criteria = parse_requirement(text)
    for k, v in (overrides or {}).items():
        if v is None or v == "":
            continue
        if k == "quantity":
            criteria.quantity = qty(v)
        elif k == "unit" and v in UNITS:
            criteria.unit = v
        elif k == "city":
            criteria.city = detect_city(str(v)) or str(v)
        elif k == "max_price":
            criteria.max_price = money(v)
        elif k == "prefer_cheap":
            criteria.prefer_cheap = bool(v)
    return rank_listings(db, criteria, limit=limit)


def compare_offers(db: Session, *, listing_ids: list[uuid.UUID] | None = None, text: str | None = None,
                   quantity: Decimal | None = None) -> dict[str, Any]:
    if listing_ids:
        listings = db.scalars(_public_base().where(MarketplaceListing.id.in_(listing_ids))).all()
    elif text:
        ranked = smart_search(db, text, overrides={"quantity": quantity} if quantity else None, limit=8)
        ids = [uuid.UUID(r["listing"]["id"]) for r in ranked["results"]]
        listings = db.scalars(_public_base().where(MarketplaceListing.id.in_(ids))).all() if ids else []
        quantity = quantity or (Decimal(ranked["criteria"]["quantity"]) if ranked["criteria"]["quantity"] else None)
    else:
        raise ValidationFailed("Müqayisə üçün məhsul və ya axtarış mətni lazımdır")
    rows = []
    for l in listings:
        s = serialize_listing(l)
        s["estimated_total"] = money_str(Decimal(l.price) * quantity) if quantity else None
        rows.append(s)
    rows.sort(key=lambda r: Decimal(r["price"]))
    return {"quantity": qty_str(quantity), "offers": rows,
            "cheapest_id": rows[0]["id"] if rows else None}
