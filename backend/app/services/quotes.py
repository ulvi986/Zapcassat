"""Quote requests (buyer → supplier) and quotations (supplier → buyer). Callers commit."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Business, BusinessMember, Profile, Quotation, QuoteRequest
from app.models.entities import UNITS
from app.services.common import audit, aware, iso, money, money_str, notify_business, notify_user, qty, qty_str, utc_now
from app.services.marketplace import get_public_listing, serialize_listing
from app.services.orders import create_order_from_quotation, serialize_order


def _require_buyer(profile: Profile) -> None:
    if not profile.buyer_onboarded:
        raise Forbidden("Təklif sorğusu üçün usta profilinizi tamamlayın", code="buyer_profile_required")


def create_quote_requests(db: Session, *, buyer: Profile, data: dict[str, Any]) -> list[QuoteRequest]:
    """One request per targeted supplier. Targets: listing_ids (preferred) or supplier_business_ids."""
    _require_buyer(buyer)
    q = qty(data["quantity"])
    if q <= 0:
        raise ValidationFailed("Miqdar müsbət olmalıdır", details={"field": "quantity"})
    listing_ids: list[uuid.UUID] = [uuid.UUID(str(x)) for x in data.get("listing_ids") or []]
    supplier_ids: list[uuid.UUID] = [uuid.UUID(str(x)) for x in data.get("supplier_business_ids") or []]
    if not listing_ids and not supplier_ids:
        raise ValidationFailed("Ən azı bir məhsul və ya topdansatıcı seçin")
    if len(listing_ids) + len(supplier_ids) > 10:
        raise ValidationFailed("Bir sorğu ən çox 10 topdansatıcıya göndərilə bilər")
    own = set(db.scalars(select(BusinessMember.business_id).where(BusinessMember.user_id == buyer.id)).all())
    group_id = uuid.uuid4()
    created: list[QuoteRequest] = []
    targets: list[tuple[uuid.UUID, Any]] = []
    for lid in listing_ids:
        listing = get_public_listing(db, lid)
        targets.append((listing.business_id, listing))
    for sid in supplier_ids:
        b = db.scalar(select(Business).where(Business.id == sid, Business.kind == "supplier"))
        if b is None:
            raise NotFound("Topdansatıcı tapılmadı")
        targets.append((b.id, None))
    for business_id, listing in targets:
        if business_id in own:
            raise Forbidden("Öz biznesinizə sorğu göndərə bilməzsiniz")
        title = (data.get("title") or (listing.title if listing else "")).strip()
        if len(title) < 2:
            raise ValidationFailed("Sorğu üçün məhsul adı lazımdır", details={"field": "title"})
        unit = data.get("unit") or (listing.unit if listing else "piece")
        if unit not in UNITS:
            raise ValidationFailed("Naməlum ölçü vahidi", details={"field": "unit"})
        qr = QuoteRequest(buyer_id=buyer.id, supplier_business_id=business_id, listing_id=listing.id if listing else None,
                          group_id=group_id, title=title[:250], quantity=q, unit=unit,
                          city=data.get("city") or buyer.city, notes=(data.get("notes") or None))
        db.add(qr)
        db.flush()
        notify_business(db, business_id, type="quote.new", title="Yeni təklif sorğusu",
                        body=f"{title} — {qty_str(q)} {unit}", link="/supplier/quotes")
        audit(db, business_id=business_id, actor_id=buyer.id, action="quote_request.create", entity_type="quote_request",
              entity_id=qr.id, after={"title": title, "quantity": q})
        created.append(qr)
    return created


def _get_supplier_request(db: Session, business_id: uuid.UUID, qr_id: uuid.UUID) -> QuoteRequest:
    qr = db.scalar(select(QuoteRequest).where(QuoteRequest.id == qr_id, QuoteRequest.supplier_business_id == business_id)
                   .with_for_update())
    if qr is None:
        raise NotFound("Sorğu tapılmadı")
    return qr


def send_quotation(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, qr_id: uuid.UUID, data: dict[str, Any]) -> Quotation:
    qr = _get_supplier_request(db, business_id, qr_id)
    if qr.status not in ("open", "quoted"):
        raise Conflict("Bu sorğuya artıq cavab vermək mümkün deyil", code="request_closed")
    unit_price = money(data["unit_price"])
    if unit_price < 0:
        raise ValidationFailed("Qiymət mənfi ola bilməz", details={"field": "unit_price"})
    quantity = qty(data.get("quantity") or qr.quantity)
    if quantity <= 0:
        raise ValidationFailed("Miqdar müsbət olmalıdır", details={"field": "quantity"})
    valid_days = int(data.get("valid_days") or 7)
    if not 1 <= valid_days <= 90:
        raise ValidationFailed("Etibarlılıq müddəti 1–90 gün olmalıdır", details={"field": "valid_days"})
    delivery_days = data.get("delivery_days")
    if delivery_days is not None and not 0 <= int(delivery_days) <= 365:
        raise ValidationFailed("Çatdırılma müddəti 0–365 gün olmalıdır", details={"field": "delivery_days"})
    # A new quotation supersedes the previous one from the same supplier.
    for old in qr.quotations:
        if old.status == "sent":
            old.status = "withdrawn"
    quotation = Quotation(quote_request_id=qr.id, supplier_business_id=business_id, created_by=actor_id,
                          unit_price=unit_price, quantity=quantity, total=money(unit_price * quantity),
                          delivery_days=int(delivery_days) if delivery_days is not None else None,
                          valid_until=utc_now() + timedelta(days=valid_days), notes=data.get("notes") or None)
    db.add(quotation)
    qr.status = "quoted"
    db.flush()
    notify_user(db, qr.buyer_id, type="quote.quoted", title="Sorğunuza təklif gəldi",
                body=f"{qr.title}: {money_str(quotation.total)} AZN", link="/buyer/quotes")
    audit(db, business_id=business_id, actor_id=actor_id, action="quotation.send", entity_type="quotation",
          entity_id=quotation.id, after={"unit_price": unit_price, "quantity": quantity, "total": quotation.total})
    return quotation


def decline_request(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, qr_id: uuid.UUID, reason: str | None) -> QuoteRequest:
    qr = _get_supplier_request(db, business_id, qr_id)
    if qr.status not in ("open", "quoted"):
        raise Conflict("Bu sorğu artıq bağlanıb", code="request_closed")
    qr.status = "declined"
    for qt in qr.quotations:
        if qt.status == "sent":
            qt.status = "withdrawn"
    notify_user(db, qr.buyer_id, type="quote.declined", title="Topdansatıcı sorğunu rədd etdi",
                body=f"{qr.title}{': ' + reason if reason else ''}", link="/buyer/quotes")
    audit(db, business_id=business_id, actor_id=actor_id, action="quote_request.decline", entity_type="quote_request",
          entity_id=qr.id, after={"reason": reason})
    db.flush()
    return qr


def _buyer_quotation(db: Session, buyer: Profile, quotation_id: uuid.UUID) -> Quotation:
    qt = db.scalar(
        select(Quotation).join(QuoteRequest, QuoteRequest.id == Quotation.quote_request_id)
        .where(Quotation.id == quotation_id, QuoteRequest.buyer_id == buyer.id)
        .options(selectinload(Quotation.quote_request).selectinload(QuoteRequest.listing))
        .with_for_update()
    )
    if qt is None:
        raise NotFound("Təklif tapılmadı")
    return qt


def accept_quotation(db: Session, *, buyer: Profile, quotation_id: uuid.UUID, delivery_address: str | None,
                     notes: str | None) -> dict:
    qt = _buyer_quotation(db, buyer, quotation_id)
    if qt.status == "accepted":
        from app.models import Order

        existing = db.scalar(select(Order).where(Order.quotation_id == qt.id))
        if existing:
            return serialize_order(existing)
    if qt.status != "sent":
        raise Conflict("Bu təklif artıq aktiv deyil", code="quotation_closed")
    if qt.valid_until and aware(qt.valid_until) < utc_now():
        raise Conflict("Təklifin etibarlılıq müddəti bitib", code="quotation_expired")
    qt.status = "accepted"
    qr = qt.quote_request
    qr.status = "accepted"
    order = create_order_from_quotation(db, buyer=buyer, quotation=qt, delivery_address=delivery_address, notes=notes)
    notify_business(db, qt.supplier_business_id, type="quote.accepted", title="Təklifiniz qəbul edildi",
                    body=f"{qr.title} — sifariş {order.order_number}", link="/supplier/orders")
    audit(db, business_id=qt.supplier_business_id, actor_id=buyer.id, action="quotation.accept", entity_type="quotation",
          entity_id=qt.id, after={"order": order.order_number})
    db.flush()
    db.refresh(order)
    return serialize_order(order)


def reject_quotation(db: Session, *, buyer: Profile, quotation_id: uuid.UUID) -> Quotation:
    qt = _buyer_quotation(db, buyer, quotation_id)
    if qt.status != "sent":
        raise Conflict("Bu təklif artıq aktiv deyil", code="quotation_closed")
    qt.status = "rejected"
    qt.quote_request.status = "open"
    notify_business(db, qt.supplier_business_id, type="quote.rejected", title="Təklifiniz rədd edildi",
                    body=qt.quote_request.title, link="/supplier/quotes")
    db.flush()
    return qt


def cancel_request(db: Session, *, buyer: Profile, qr_id: uuid.UUID) -> QuoteRequest:
    qr = db.scalar(select(QuoteRequest).where(QuoteRequest.id == qr_id, QuoteRequest.buyer_id == buyer.id).with_for_update())
    if qr is None:
        raise NotFound("Sorğu tapılmadı")
    if qr.status not in ("open", "quoted"):
        raise Conflict("Bu sorğu artıq bağlanıb", code="request_closed")
    qr.status = "cancelled"
    for qt in qr.quotations:
        if qt.status == "sent":
            qt.status = "withdrawn"
    db.flush()
    return qr


def serialize_quotation(qt: Quotation) -> dict:
    return {"id": str(qt.id), "unit_price": money_str(qt.unit_price), "quantity": qty_str(qt.quantity),
            "total": money_str(qt.total), "currency": qt.currency, "delivery_days": qt.delivery_days,
            "valid_until": iso(qt.valid_until), "notes": qt.notes, "status": qt.status, "created_at": iso(qt.created_at)}


def serialize_request(qr: QuoteRequest, *, for_supplier: bool) -> dict:
    out = {
        "id": str(qr.id), "group_id": str(qr.group_id) if qr.group_id else None, "title": qr.title,
        "quantity": qty_str(qr.quantity), "unit": qr.unit, "city": qr.city, "notes": qr.notes, "status": qr.status,
        "created_at": iso(qr.created_at),
        "listing": serialize_listing(qr.listing) if qr.listing else None,
        "quotations": [serialize_quotation(q) for q in qr.quotations],
    }
    if for_supplier:
        b = qr.buyer
        out["buyer"] = {"name": b.full_name or b.email, "email": b.email, "phone": b.phone, "city": b.city,
                        "specialty": b.specialty, "company_name": b.company_name}
    else:
        s = qr.supplier
        out["supplier"] = {"name": s.name, "slug": s.slug, "city": s.city, "verified": s.verified}
    return out


def _request_options():
    from app.models import MarketplaceListing, Product

    return (
        selectinload(QuoteRequest.quotations),
        selectinload(QuoteRequest.buyer),
        selectinload(QuoteRequest.supplier),
        selectinload(QuoteRequest.listing).selectinload(MarketplaceListing.product).selectinload(Product.inventory),
        selectinload(QuoteRequest.listing).selectinload(MarketplaceListing.product).selectinload(Product.images),
        selectinload(QuoteRequest.listing).selectinload(MarketplaceListing.business),
        selectinload(QuoteRequest.listing).selectinload(MarketplaceListing.category),
    )


def list_supplier_requests(db: Session, business_id: uuid.UUID, status: str | None = None) -> list[dict]:
    stmt = select(QuoteRequest).where(QuoteRequest.supplier_business_id == business_id).options(*_request_options())
    if status:
        stmt = stmt.where(QuoteRequest.status == status)
    return [serialize_request(r, for_supplier=True) for r in db.scalars(stmt.order_by(QuoteRequest.created_at.desc()).limit(200)).all()]


def list_buyer_requests(db: Session, buyer_id: uuid.UUID) -> list[dict]:
    stmt = select(QuoteRequest).where(QuoteRequest.buyer_id == buyer_id).options(*_request_options())
    return [serialize_request(r, for_supplier=False) for r in db.scalars(stmt.order_by(QuoteRequest.created_at.desc()).limit(200)).all()]

