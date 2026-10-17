"""Private product catalogue of a supplier business.

Mutating functions flush but never commit; the caller owns the transaction
(see services.common.run_idempotent)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import Inventory, InventoryEvent, MarketplaceListing, Product, ProductCategory, SellerSku
from app.models.entities import UNITS
from app.services.categories import guess_category_id
from app.services.common import audit, aware, iso, money, money_str, qty, qty_str
from app.services.lexicon import analyze, build_search_text, fold

EDITABLE_FIELDS = {
    "name", "sku", "category_id", "description", "attributes", "unit", "purchase_price",
    "selling_price", "currency", "low_stock_threshold",
}


def stock_status(quantity: Decimal, threshold: int) -> str:
    if quantity <= 0:
        return "out_of_stock"
    if quantity <= threshold:
        return "low"
    return "in_stock"


def inventory_value(p: Product) -> Decimal:
    """Inventory value at cost; falls back to selling price when no purchase price is recorded."""
    q = p.inventory.quantity if p.inventory else Decimal(0)
    unit_value = p.purchase_price if p.purchase_price is not None else (p.selling_price or Decimal(0))
    return (Decimal(q) * Decimal(unit_value)).quantize(Decimal("0.01"))


def _refresh_search_text(db: Session, p: Product) -> None:
    aliases = db.scalars(select(SellerSku.code).where(SellerSku.product_id == p.id)).all() if p.id else []
    attrs = " ".join(str(v) for v in (p.attributes or {}).values())
    p.search_text = build_search_text(p.name, p.description, attrs, p.sku, " ".join(aliases))


def _next_sku(db: Session, business_id: uuid.UUID, name: str) -> str:
    letters = "".join(ch for ch in fold(name).upper() if "A" <= ch <= "Z")[:3] or "PRD"
    n = (db.scalar(select(func.count()).select_from(Product).where(Product.business_id == business_id)) or 0) + 1
    while True:
        sku = f"{letters}-{n:04d}"
        if not db.scalar(select(Product.id).where(Product.business_id == business_id, Product.sku == sku)):
            return sku
        n += 1


def _validate_fields(data: dict[str, Any]) -> dict[str, Any]:
    out = dict(data)
    if "name" in out:
        out["name"] = (out["name"] or "").strip()
        if len(out["name"]) < 2:
            raise ValidationFailed("Məhsul adı ən azı 2 simvol olmalıdır", details={"field": "name"})
    if "unit" in out and out["unit"] not in UNITS:
        raise ValidationFailed(f"Naməlum ölçü vahidi: {out['unit']}", details={"field": "unit"})
    for f in ("purchase_price", "selling_price"):
        if f in out and out[f] is not None:
            out[f] = money(out[f])
            if out[f] < 0:
                raise ValidationFailed("Qiymət mənfi ola bilməz", details={"field": f})
    if "currency" in out:
        out["currency"] = (out["currency"] or "AZN").upper()
        if out["currency"] != "AZN":
            raise ValidationFailed("Hazırda yalnız AZN dəstəklənir", details={"field": "currency"})
    if "low_stock_threshold" in out and out["low_stock_threshold"] is not None:
        out["low_stock_threshold"] = int(out["low_stock_threshold"])
        if out["low_stock_threshold"] < 0:
            raise ValidationFailed("Minimum stok həddi mənfi ola bilməz")
    if "sku" in out and out["sku"] is not None:
        out["sku"] = out["sku"].strip()[:64] or None
    if "category_id" in out and isinstance(out["category_id"], str):
        out["category_id"] = uuid.UUID(out["category_id"]) if out["category_id"] else None
    return out


def get_product(db: Session, business_id: uuid.UUID, product_id: uuid.UUID, *, lock: bool = False) -> Product:
    stmt = (
        select(Product)
        .where(Product.id == product_id, Product.business_id == business_id)
        .options(selectinload(Product.inventory), selectinload(Product.images), selectinload(Product.category))
    )
    if lock:
        stmt = stmt.with_for_update()
    p = db.scalar(stmt)
    if p is None:
        raise NotFound("Məhsul tapılmadı")
    return p


def create_product(
    db: Session,
    *,
    actor_id: uuid.UUID,
    business_id: uuid.UUID,
    data: dict[str, Any],
    initial_quantity: Any = 0,
    aliases: list[str] | None = None,
    via: str = "api",
    ai_action_id: uuid.UUID | None = None,
    publish: bool = True,
) -> Product:
    data = _validate_fields({k: v for k, v in data.items() if k in EDITABLE_FIELDS})
    if "name" not in data:
        raise ValidationFailed("Məhsul adı tələb olunur", details={"field": "name"})
    init_qty = qty(initial_quantity or 0)
    if init_qty < 0:
        raise ValidationFailed("Miqdar mənfi ola bilməz", details={"field": "quantity"})
    sku = data.pop("sku", None) or _next_sku(db, business_id, data["name"])
    if db.scalar(select(Product.id).where(Product.business_id == business_id, Product.sku == sku)):
        raise Conflict(f"Bu SKU artıq mövcuddur: {sku}", code="sku_taken")
    if not data.get("category_id"):
        data["category_id"] = guess_category_id(db, f"{data['name']} {data.get('description') or ''}")
    if data.get("category_id") and not db.get(ProductCategory, data["category_id"]):
        raise ValidationFailed("Kateqoriya tapılmadı", details={"field": "category_id"})

    product = Product(business_id=business_id, sku=sku, attributes=data.pop("attributes", None) or {}, **data)
    db.add(product)
    db.flush()
    for code in aliases or []:
        code = code.strip()[:120]
        if code and not db.scalar(select(SellerSku.id).where(SellerSku.business_id == business_id, SellerSku.code == code)):
            db.add(SellerSku(business_id=business_id, product_id=product.id, code=code))
    inv = Inventory(business_id=business_id, product_id=product.id, quantity=init_qty)
    db.add(inv)
    db.flush()
    db.add(
        InventoryEvent(
            business_id=business_id, product_id=product.id, inventory_id=inv.id, event_type="initial",
            source="ai" if via == "ai" else ("import" if via == "import" else "manual"),
            delta=init_qty, quantity_before=Decimal(0), quantity_after=init_qty, reason="İlkin qalıq",
            actor_id=actor_id, ai_action_id=ai_action_id,
        )
    )
    _refresh_search_text(db, product)
    audit(db, business_id=business_id, actor_id=actor_id, action="product.create", entity_type="product",
          entity_id=product.id, after={"name": product.name, "sku": sku, "quantity": init_qty,
                                       "selling_price": product.selling_price}, via=via)
    db.flush()
    if publish and product.selling_price is not None:
        # Buyers only see marketplace listings, so a priced product goes on the market right away.
        # Without a selling price there is nothing truthful to show; it stays private until priced.
        from app.models import Business
        from app.services.marketplace import upsert_listing

        upsert_listing(db, actor_id=actor_id, business=db.get(Business, business_id), product=product,
                       data={"status": "active"})
    db.refresh(product)
    return product


def update_product(db: Session, *, actor_id: uuid.UUID, product: Product, data: dict[str, Any], via: str = "api") -> Product:
    data = _validate_fields({k: v for k, v in data.items() if k in EDITABLE_FIELDS})
    if "sku" in data:
        if not data["sku"]:
            data.pop("sku")
        elif data["sku"] != product.sku and db.scalar(
            select(Product.id).where(Product.business_id == product.business_id, Product.sku == data["sku"])
        ):
            raise Conflict(f"Bu SKU artıq mövcuddur: {data['sku']}", code="sku_taken")
    before = {k: getattr(product, k) for k in data}
    changed = {k: v for k, v in data.items() if before.get(k) != v}
    if not changed:
        return product
    old_price = product.selling_price
    for k, v in changed.items():
        setattr(product, k, v)
    # keep the public listing price in sync unless the supplier deliberately set a different one
    if "selling_price" in changed and product.selling_price is not None:
        listing = db.scalar(select(MarketplaceListing).where(MarketplaceListing.product_id == product.id))
        if listing and (old_price is None or listing.price == old_price):
            listing.price = product.selling_price
    _refresh_search_text(db, product)
    action = "product.price_change" if set(changed) <= {"selling_price", "purchase_price"} else "product.update"
    audit(db, business_id=product.business_id, actor_id=actor_id, action=action, entity_type="product",
          entity_id=product.id, before={k: before[k] for k in changed}, after=changed, via=via)
    db.flush()
    return product


def archive_products(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, product_ids: list[uuid.UUID],
                     archived: bool = True) -> int:
    products = db.scalars(select(Product).where(Product.business_id == business_id, Product.id.in_(product_ids))).all()
    for p in products:
        p.is_archived = archived
        listing = db.scalar(select(MarketplaceListing).where(MarketplaceListing.product_id == p.id))
        if listing and archived and listing.status == "active":
            listing.status = "paused"
        audit(db, business_id=business_id, actor_id=actor_id, action="product.archive" if archived else "product.restore",
              entity_type="product", entity_id=p.id)
    db.flush()
    return len(products)


def list_products(
    db: Session,
    business_id: uuid.UUID,
    *,
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    stock: str | None = None,
    include_archived: bool = False,
    sort: str = "-updated_at",
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Product], int]:
    stmt = select(Product).join(Inventory, Inventory.product_id == Product.id).where(Product.business_id == business_id)
    if not include_archived:
        stmt = stmt.where(Product.is_archived.is_(False))
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if q:
        concepts, rest = analyze(q)
        terms = [f"#{c}" for c in concepts] + rest
        if not terms:
            terms = [fold(q)]
        stmt = stmt.where(or_(*[Product.search_text.ilike(f"%{t}%") for t in terms], Product.sku.ilike(f"%{q.strip()}%")))
    if stock == "low":
        stmt = stmt.where(Inventory.quantity > 0, Inventory.quantity <= Product.low_stock_threshold)
    elif stock == "out":
        stmt = stmt.where(Inventory.quantity <= 0)
    elif stock == "in":
        stmt = stmt.where(Inventory.quantity > Product.low_stock_threshold)
    elif stock == "attention":
        stmt = stmt.where(Inventory.quantity <= Product.low_stock_threshold)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    sort_map = {
        "name": Product.name, "sku": Product.sku, "quantity": Inventory.quantity, "selling_price": Product.selling_price,
        "purchase_price": Product.purchase_price, "updated_at": Product.updated_at, "created_at": Product.created_at,
    }
    desc = sort.startswith("-")
    col = sort_map.get(sort.lstrip("-"), Product.updated_at)
    stmt = stmt.order_by(col.desc() if desc else col.asc(), Product.id)
    stmt = stmt.options(selectinload(Product.inventory), selectinload(Product.images), selectinload(Product.category))
    page_size = max(1, min(page_size, 500))
    items = db.scalars(stmt.offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
    return list(items), total


def find_matching_products(db: Session, business_id: uuid.UUID, text: str, limit: int = 3) -> list[tuple[Product, float]]:
    """Fuzzy match free text (e.g. 'taxta qapı') to the business's existing products by concept overlap."""
    concepts, rest = analyze(text)
    keys = {f"#{c}" for c in concepts} | set(rest)
    if not keys:
        return []
    candidates = db.scalars(
        select(Product)
        .where(Product.business_id == business_id, Product.is_archived.is_(False),
               or_(*[Product.search_text.ilike(f"%{k}%") for k in keys]))
        .options(selectinload(Product.inventory))
        .limit(200)
    ).all()
    scored: list[tuple[Product, float]] = []
    for p in candidates:
        p_tokens = set(p.search_text.split())
        p_concepts = {t for t in p_tokens if t.startswith("#")}
        overlap = len(keys & p_tokens)
        # penalise products that carry extra distinguishing concepts the query did not mention
        extra = len(p_concepts - keys)
        score = overlap / max(len(keys), 1) - 0.15 * extra
        if overlap and score > 0.3:
            scored.append((p, round(score, 3)))
    scored.sort(key=lambda x: -x[1])
    return scored[:limit]


def serialize_product(p: Product, listing: MarketplaceListing | None = None) -> dict[str, Any]:
    q = p.inventory.quantity if p.inventory else Decimal(0)
    return {
        "id": str(p.id),
        "sku": p.sku,
        "name": p.name,
        "description": p.description,
        "attributes": p.attributes or {},
        "category": {"id": str(p.category.id), "name_az": p.category.name_az, "slug": p.category.slug} if p.category else None,
        "unit": p.unit,
        "quantity": qty_str(q),
        "reserved": qty_str(p.inventory.reserved if p.inventory else Decimal(0)),
        "purchase_price": money_str(p.purchase_price),
        "selling_price": money_str(p.selling_price),
        "currency": p.currency,
        "inventory_value": money_str(inventory_value(p)),
        "low_stock_threshold": p.low_stock_threshold,
        "stock_status": stock_status(Decimal(q), p.low_stock_threshold),
        "is_archived": p.is_archived,
        "images": [{"id": str(i.id), "url": i.url} for i in p.images],
        "listing": {"id": str(listing.id), "status": listing.status, "price": money_str(listing.price)} if listing else None,
        "inventory_version": p.inventory.version if p.inventory else 0,
        "created_at": iso(p.created_at),
        "updated_at": iso(max(aware(p.updated_at), aware(p.inventory.updated_at))) if p.inventory else iso(p.updated_at),
    }
