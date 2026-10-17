"""Supplier workspace. Every route is scoped by /businesses/{business_id} and guarded by SupplierMember."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, File, Query, Response, UploadFile
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, IdempotencyKey, SettingsDep, SupplierMember
from app.core.errors import NotFound, ValidationFailed
from app.models import AuditLog, MarketplaceListing, ProductImage
from app.schemas.requests import (
    BulkIdsIn,
    BusinessUpdateIn,
    DeclineIn,
    ListingIn,
    ListingUpdateIn,
    OrderStatusIn,
    ProductCreateIn,
    ProductUpdateIn,
    QuotationIn,
    StockAdjustIn,
)
from app.services import accounts, analytics, inventory, marketplace, orders, products, quotes, storage
from app.services.common import iso, run_idempotent

router = APIRouter(prefix="/businesses/{business_id}", tags=["supplier"])


def _product_out(db, p):
    listing = db.scalar(select(MarketplaceListing).where(MarketplaceListing.product_id == p.id))
    return products.serialize_product(p, listing)


@router.get("")
def get_business(m: SupplierMember):
    return accounts.serialize_business(m.business, private=True)


@router.patch("")
def update_business(body: BusinessUpdateIn, db: DB, user: CurrentUser, m: SupplierMember):
    if m.role not in ("owner", "admin"):
        from app.core.errors import Forbidden

        raise Forbidden("Yalnız sahibi və ya admin dəyişə bilər")
    b = accounts.update_business(db, user, m.business, body.model_dump(exclude_unset=True))
    return accounts.serialize_business(b, private=True)


# ----------------------------------------------------------------- products
@router.get("/products")
def list_products(
    m: SupplierMember, db: DB,
    q: str | None = Query(default=None, max_length=200),
    category_id: uuid.UUID | None = None,
    stock: Literal["low", "out", "in", "attention"] | None = None,
    include_archived: bool = False,
    sort: str = Query(default="-updated_at", max_length=30),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
):
    items, total = products.list_products(db, m.business.id, q=q, category_id=category_id, stock=stock,
                                          include_archived=include_archived, sort=sort, page=page, page_size=page_size)
    listings = {l.product_id: l for l in db.scalars(select(MarketplaceListing).where(
        MarketplaceListing.product_id.in_([p.id for p in items]))).all()} if items else {}
    return {"items": [products.serialize_product(p, listings.get(p.id)) for p in items], "total": total,
            "page": page, "page_size": page_size}


@router.post("/products", status_code=201)
def create_product(body: ProductCreateIn, m: SupplierMember, db: DB, user: CurrentUser, idem: IdempotencyKey = None):
    def work():
        data = body.model_dump(exclude={"quantity", "aliases", "publish"})
        p = products.create_product(db, actor_id=user.id, business_id=m.business.id, data=data,
                                    initial_quantity=body.quantity, aliases=body.aliases, publish=body.publish)
        return _product_out(db, products.get_product(db, m.business.id, p.id))

    return run_idempotent(db, user_id=user.id, key=idem, scope=f"product.create:{m.business.id}", fn=work)


@router.get("/products/{product_id}")
def get_product(product_id: uuid.UUID, m: SupplierMember, db: DB):
    return _product_out(db, products.get_product(db, m.business.id, product_id))


@router.patch("/products/{product_id}")
def update_product(product_id: uuid.UUID, body: ProductUpdateIn, m: SupplierMember, db: DB, user: CurrentUser):
    p = products.get_product(db, m.business.id, product_id, lock=True)
    products.update_product(db, actor_id=user.id, product=p, data=body.model_dump(exclude_unset=True))
    db.commit()
    return _product_out(db, products.get_product(db, m.business.id, product_id))


@router.post("/products/archive")
def archive_products(body: BulkIdsIn, m: SupplierMember, db: DB, user: CurrentUser):
    n = products.archive_products(db, actor_id=user.id, business_id=m.business.id, product_ids=body.ids, archived=body.archived)
    db.commit()
    return {"updated": n}


@router.post("/products/{product_id}/images", status_code=201)
async def upload_image(product_id: uuid.UUID, m: SupplierMember, db: DB, user: CurrentUser, settings: SettingsDep,
                       file: UploadFile = File(...)):
    p = products.get_product(db, m.business.id, product_id)
    if len(p.images) >= 8:
        raise ValidationFailed("Bir məhsul üçün ən çox 8 şəkil")
    content = await file.read(settings.max_upload_bytes + 1)
    path, url, ctype = storage.store_image(settings, business_id=m.business.id, product_id=p.id, content=content)
    img = ProductImage(business_id=m.business.id, product_id=p.id, storage_path=path, url=url, content_type=ctype,
                       size_bytes=len(content), position=len(p.images))
    db.add(img)
    db.commit()
    return {"id": str(img.id), "url": url}


@router.delete("/products/{product_id}/images/{image_id}", status_code=204)
def delete_image(product_id: uuid.UUID, image_id: uuid.UUID, m: SupplierMember, db: DB, settings: SettingsDep):
    img = db.scalar(select(ProductImage).where(ProductImage.id == image_id, ProductImage.product_id == product_id,
                                               ProductImage.business_id == m.business.id))
    if img is None:
        raise NotFound("Şəkil tapılmadı")
    path = img.storage_path
    db.delete(img)
    db.commit()
    storage.delete_image(settings, path)
    return Response(status_code=204)


# ----------------------------------------------------------------- inventory
@router.post("/inventory/{product_id}/adjust")
def adjust(product_id: uuid.UUID, body: StockAdjustIn, m: SupplierMember, db: DB, user: CurrentUser,
           idem: IdempotencyKey = None):
    def work():
        ev = inventory.adjust_stock(db, actor_id=user.id, business_id=m.business.id, product_id=product_id,
                                    delta=body.delta, set_to=body.set_quantity, reason=body.reason, source="manual",
                                    expected_version=body.expected_version,
                                    idempotency_key=f"adjust:{idem}" if idem else None)
        p = products.get_product(db, m.business.id, product_id)
        return {"event": inventory.serialize_event(ev, p.name, p.unit), "product": _product_out(db, p)}

    return run_idempotent(db, user_id=user.id, key=idem, scope=f"inventory.adjust:{product_id}", fn=work)


@router.get("/inventory/events")
def events(m: SupplierMember, db: DB, product_id: uuid.UUID | None = None, limit: int = Query(default=50, ge=1, le=200)):
    return {"items": inventory.list_events(db, m.business.id, product_id=product_id, limit=limit)}


@router.post("/inventory/events/{event_id}/undo")
def undo(event_id: uuid.UUID, m: SupplierMember, db: DB, user: CurrentUser):
    ev = inventory.undo_event(db, actor_id=user.id, business_id=m.business.id, event_id=event_id)
    db.commit()
    p = products.get_product(db, m.business.id, ev.product_id)
    return {"event": inventory.serialize_event(ev, p.name, p.unit), "product": _product_out(db, p)}


@router.get("/inventory/summary")
def inv_summary(m: SupplierMember, db: DB):
    return inventory.summary(db, m.business.id)


@router.get("/inventory/export")
def export(m: SupplierMember, db: DB, format: Literal["csv", "xlsx"] = "csv"):
    if format == "xlsx":
        data = inventory.export_xlsx(db, m.business.id)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        data = inventory.export_csv(db, m.business.id)
        media = "text/csv; charset=utf-8"
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="inventar-{m.business.slug}.{format}"'})


@router.post("/inventory/import")
async def import_file(m: SupplierMember, db: DB, user: CurrentUser, settings: SettingsDep, dry_run: bool = True,
                      file: UploadFile = File(...)):
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise ValidationFailed("Fayl çox böyükdür")
    rows = inventory.parse_upload(file.filename or "upload.csv", content)
    result = inventory.import_rows(db, actor_id=user.id, business_id=m.business.id, rows=rows, dry_run=dry_run)
    if not dry_run:
        db.commit()
    return result


# ----------------------------------------------------------------- listings
@router.get("/listings")
def listings(m: SupplierMember, db: DB):
    return {"items": marketplace.list_business_listings(db, m.business.id)}


@router.post("/listings", status_code=201)
def create_listing(body: ListingIn, m: SupplierMember, db: DB, user: CurrentUser):
    p = products.get_product(db, m.business.id, body.product_id)
    l = marketplace.upsert_listing(db, actor_id=user.id, business=m.business, product=p,
                                   data=body.model_dump(exclude={"product_id"}, exclude_none=True))
    db.commit()
    return marketplace.serialize_listing(marketplace.get_business_listing(db, m.business.id, l.id))


@router.patch("/listings/{listing_id}")
def update_listing(listing_id: uuid.UUID, body: ListingUpdateIn, m: SupplierMember, db: DB, user: CurrentUser):
    l = marketplace.get_business_listing(db, m.business.id, listing_id)
    p = products.get_product(db, m.business.id, l.product_id)
    marketplace.upsert_listing(db, actor_id=user.id, business=m.business, product=p,
                               data=body.model_dump(exclude_unset=True))
    db.commit()
    return marketplace.serialize_listing(marketplace.get_business_listing(db, m.business.id, listing_id))


@router.delete("/listings/{listing_id}", status_code=204)
def delete_listing(listing_id: uuid.UUID, m: SupplierMember, db: DB, user: CurrentUser):
    from app.services.common import audit

    l = marketplace.get_business_listing(db, m.business.id, listing_id)
    audit(db, business_id=m.business.id, actor_id=user.id, action="listing.delete", entity_type="listing", entity_id=l.id)
    db.delete(l)
    db.commit()
    return Response(status_code=204)


# ----------------------------------------------------------------- quotes
@router.get("/quote-requests")
def quote_requests(m: SupplierMember, db: DB, status: str | None = Query(default=None, max_length=12)):
    return {"items": quotes.list_supplier_requests(db, m.business.id, status)}


@router.post("/quote-requests/{qr_id}/quotations", status_code=201)
def send_quotation(qr_id: uuid.UUID, body: QuotationIn, m: SupplierMember, db: DB, user: CurrentUser,
                   idem: IdempotencyKey = None):
    def work():
        qt = quotes.send_quotation(db, actor_id=user.id, business_id=m.business.id, qr_id=qr_id, data=body.model_dump())
        return quotes.serialize_quotation(qt)

    return run_idempotent(db, user_id=user.id, key=idem, scope=f"quotation:{qr_id}", fn=work)


@router.post("/quote-requests/{qr_id}/decline")
def decline(qr_id: uuid.UUID, body: DeclineIn, m: SupplierMember, db: DB, user: CurrentUser):
    quotes.decline_request(db, actor_id=user.id, business_id=m.business.id, qr_id=qr_id, reason=body.reason)
    db.commit()
    return {"ok": True}


# ----------------------------------------------------------------- orders
@router.get("/orders")
def supplier_orders(m: SupplierMember, db: DB, status: str | None = Query(default=None, max_length=12)):
    return {"items": orders.list_supplier_orders(db, m.business.id, status)}


@router.post("/orders/{order_id}/status")
def order_status(order_id: uuid.UUID, body: OrderStatusIn, m: SupplierMember, db: DB, user: CurrentUser):
    o = orders.set_status_by_supplier(db, actor_id=user.id, business_id=m.business.id, order_id=order_id, status=body.status)
    db.commit()
    db.refresh(o)
    return orders.serialize_order(o, for_supplier=True)


# ----------------------------------------------------------------- analytics & audit
@router.get("/analytics/overview")
def overview(m: SupplierMember, db: DB, days: int = Query(default=30, ge=7, le=365)):
    return analytics.overview(db, m.business.id, days=days)


@router.get("/analytics/sales")
def sales(m: SupplierMember, db: DB, metric: Literal["top_revenue", "top_units", "unsold"] = "top_revenue",
          days: int = Query(default=30, ge=1, le=365)):
    return analytics.sales_analytics(db, m.business.id, metric=metric, days=days)


@router.get("/audit-logs")
def audit_logs(m: SupplierMember, db: DB, limit: int = Query(default=50, ge=1, le=200)):
    rows = db.scalars(select(AuditLog).where(AuditLog.business_id == m.business.id)
                      .order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return {"items": [{"id": str(a.id), "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id,
                       "before": a.before, "after": a.after, "via": a.via, "created_at": iso(a.created_at)} for a in rows]}
