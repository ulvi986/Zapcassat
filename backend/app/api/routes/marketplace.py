"""Public catalogue + buyer (craftsman) actions."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser, IdempotencyKey, SettingsDep, rate_limit
from app.core.rate_limit import limiter
from app.models import Favorite, MarketplaceListing
from app.schemas.requests import AcceptQuotationIn, OrderIn, QuoteRequestIn, SmartSearchIn
from app.services import categories, marketplace, orders, quotes
from app.services.common import run_idempotent

public = APIRouter(prefix="/marketplace", tags=["marketplace"], dependencies=[Depends(rate_limit)])
buyer = APIRouter(tags=["buyer"])


@public.get("/categories")
def list_categories(db: DB):
    return {"items": [categories.serialize_category(c) for c in categories.list_categories(db)]}


@public.get("/listings")
def browse(
    db: DB,
    q: str | None = Query(default=None, max_length=200),
    category: str | None = Query(default=None, max_length=80),
    city: str | None = Query(default=None, max_length=100),
    supplier: str | None = Query(default=None, max_length=220),
    min_price: Decimal | None = Query(default=None, ge=0),
    max_price: Decimal | None = Query(default=None, ge=0),
    in_stock: bool = False,
    sort: Literal["newest", "price_asc", "price_desc"] = "newest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=60),
):
    return marketplace.browse(db, q=q, category=category, city=city, supplier=supplier, min_price=min_price,
                              max_price=max_price, in_stock=in_stock, sort=sort, page=page, page_size=page_size)


@public.get("/listings/{listing_id}")
def listing_detail(listing_id: uuid.UUID, db: DB):
    l = marketplace.get_public_listing(db, listing_id)
    out = marketplace.serialize_listing(l)
    similar = marketplace.browse(db, category=l.category.slug if l.category else None, page_size=8)["items"] if l.category else []
    out["similar"] = [s for s in similar if s["id"] != out["id"]][:6]
    return out


@public.get("/cities")
def cities(db: DB):
    return {"items": marketplace.list_cities(db)}


@public.get("/suppliers")
def suppliers(db: DB, city: str | None = Query(default=None, max_length=100), q: str | None = Query(default=None, max_length=100)):
    return {"items": marketplace.list_suppliers(db, city=city, q=q)}


@public.get("/suppliers/{slug}")
def supplier_detail(slug: str, db: DB):
    return marketplace.get_supplier(db, slug)


@public.post("/smart-search")
def smart_search(body: SmartSearchIn, db: DB, settings: SettingsDep):
    """Deterministic requirement parsing + ranking over real listings (used by the AI search box)."""
    return marketplace.smart_search(db, body.query, overrides={"quantity": body.quantity, "city": body.city,
                                                                "max_price": body.max_price})


# ----------------------------------------------------------------- buyer
@buyer.post("/quote-requests", status_code=201)
def create_quote_request(body: QuoteRequestIn, db: DB, user: CurrentUser, settings: SettingsDep, idem: IdempotencyKey = None):
    limiter.hit(f"quote:{user.id}", 30)

    def work():
        created = quotes.create_quote_requests(db, buyer=user, data=body.model_dump())
        return {"ids": [str(q.id) for q in created], "count": len(created),
                "group_id": str(created[0].group_id) if created else None}

    return run_idempotent(db, user_id=user.id, key=idem, scope="quote_request.create", fn=work)


@buyer.get("/quote-requests")
def my_quote_requests(db: DB, user: CurrentUser):
    return {"items": quotes.list_buyer_requests(db, user.id)}


@buyer.post("/quote-requests/{qr_id}/cancel")
def cancel_quote_request(qr_id: uuid.UUID, db: DB, user: CurrentUser):
    quotes.cancel_request(db, buyer=user, qr_id=qr_id)
    db.commit()
    return {"ok": True}


@buyer.post("/quotations/{quotation_id}/accept")
def accept_quotation(quotation_id: uuid.UUID, body: AcceptQuotationIn, db: DB, user: CurrentUser, idem: IdempotencyKey = None):
    def work():
        return quotes.accept_quotation(db, buyer=user, quotation_id=quotation_id, delivery_address=body.delivery_address,
                                       notes=body.notes)

    return run_idempotent(db, user_id=user.id, key=idem, scope=f"quotation.accept:{quotation_id}", fn=work)


@buyer.post("/quotations/{quotation_id}/reject")
def reject_quotation(quotation_id: uuid.UUID, db: DB, user: CurrentUser):
    quotes.reject_quotation(db, buyer=user, quotation_id=quotation_id)
    db.commit()
    return {"ok": True}


@buyer.post("/orders", status_code=201)
def create_order(body: OrderIn, db: DB, user: CurrentUser, idem: IdempotencyKey = None):
    if not user.buyer_onboarded:
        from app.core.errors import Forbidden

        raise Forbidden("Sifariş üçün usta profilinizi tamamlayın", code="buyer_profile_required")

    def work():
        o = orders.create_order_from_listing(db, buyer=user, listing_id=body.listing_id, quantity=body.quantity,
                                             notes=body.notes, delivery_address=body.delivery_address, idempotency_key=idem)
        db.flush()
        db.refresh(o)
        return orders.serialize_order(o)

    return run_idempotent(db, user_id=user.id, key=idem, scope="order.create", fn=work)


@buyer.get("/orders")
def my_orders(db: DB, user: CurrentUser):
    return {"items": orders.list_buyer_orders(db, user.id)}


@buyer.post("/orders/{order_id}/cancel")
def cancel_order(order_id: uuid.UUID, db: DB, user: CurrentUser):
    o = orders.cancel_by_buyer(db, buyer=user, order_id=order_id)
    db.commit()
    return {"ok": True, "status": o.status}


@buyer.get("/favorites")
def favorites(db: DB, user: CurrentUser):
    ids = db.scalars(select(Favorite.listing_id).where(Favorite.user_id == user.id).order_by(Favorite.created_at.desc())).all()
    if not ids:
        return {"items": [], "ids": []}
    items = [marketplace.serialize_listing(l) for l in db.scalars(
        marketplace._public_base().where(MarketplaceListing.id.in_(ids))).all()]
    return {"items": items, "ids": [str(i) for i in ids]}


@buyer.put("/favorites/{listing_id}", status_code=204)
def add_favorite(listing_id: uuid.UUID, db: DB, user: CurrentUser):
    marketplace.get_public_listing(db, listing_id)
    db.add(Favorite(user_id=user.id, listing_id=listing_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # already a favourite
    return Response(status_code=204)


@buyer.delete("/favorites/{listing_id}", status_code=204)
def remove_favorite(listing_id: uuid.UUID, db: DB, user: CurrentUser):
    fav = db.scalar(select(Favorite).where(Favorite.user_id == user.id, Favorite.listing_id == listing_id))
    if fav:
        db.delete(fav)
        db.commit()
    return Response(status_code=204)
