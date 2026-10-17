"""Orders. Stock is decremented when the supplier confirms, inside the same transaction,
through the inventory ledger (so it can never go negative). Callers commit."""

from __future__ import annotations

import secrets
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import BusinessMember, Order, OrderItem, Profile, Quotation
from app.services.common import audit, iso, money, money_str, notify_business, notify_user, qty, qty_str, utc_now
from app.services.inventory import adjust_stock
from app.services.marketplace import available_quantity, get_public_listing

TRANSITIONS = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"fulfilled", "cancelled"},
    "fulfilled": set(),
    "cancelled": set(),
}


def _order_number(db: Session) -> str:
    while True:
        n = f"UH-{utc_now():%y%m%d}-{secrets.token_hex(3).upper()}"
        if not db.scalar(select(Order.id).where(Order.order_number == n)):
            return n


def _ensure_not_own_business(db: Session, buyer_id: uuid.UUID, business_id: uuid.UUID) -> None:
    if db.scalar(select(BusinessMember.id).where(BusinessMember.user_id == buyer_id, BusinessMember.business_id == business_id)):
        raise Forbidden("Öz biznesinizdən sifariş verə bilməzsiniz")


def create_order_from_listing(db: Session, *, buyer: Profile, listing_id: uuid.UUID, quantity: Any,
                              notes: str | None, delivery_address: str | None, idempotency_key: str | None) -> Order:
    if idempotency_key:
        prior = db.scalar(select(Order).where(Order.buyer_id == buyer.id, Order.idempotency_key == idempotency_key))
        if prior:
            return prior
    listing = get_public_listing(db, listing_id)
    _ensure_not_own_business(db, buyer.id, listing.business_id)
    q = qty(quantity)
    if q <= 0:
        raise ValidationFailed("Miqdar müsbət olmalıdır")
    if q < Decimal(listing.min_order_qty):
        raise ValidationFailed(f"Minimum sifariş miqdarı: {qty_str(listing.min_order_qty)}", code="below_moq")
    if available_quantity(listing) < q:
        raise ValidationFailed("Satıcının anbarında kifayət qədər məhsul yoxdur. Təklif sorğusu göndərə bilərsiniz.",
                               code="insufficient_stock")
    unit_price = money(listing.price)
    total = money(unit_price * q)
    order = Order(order_number=_order_number(db), buyer_id=buyer.id, supplier_business_id=listing.business_id,
                  status="pending", subtotal=total, total=total, currency=listing.currency, notes=notes,
                  delivery_address=delivery_address, idempotency_key=idempotency_key)
    order.items.append(OrderItem(product_id=listing.product_id, listing_id=listing.id, name=listing.title, quantity=q,
                                 unit=listing.unit, unit_price=unit_price, line_total=total))
    db.add(order)
    db.flush()
    notify_business(db, listing.business_id, type="order.new", title=f"Yeni sifariş {order.order_number}",
                    body=f"{listing.title} — {qty_str(q)} {listing.unit}", link="/supplier/orders")
    audit(db, business_id=listing.business_id, actor_id=buyer.id, action="order.create", entity_type="order",
          entity_id=order.id, after={"total": total, "number": order.order_number})
    return order


def create_order_from_quotation(db: Session, *, buyer: Profile, quotation: Quotation, delivery_address: str | None,
                                notes: str | None) -> Order:
    qr = quotation.quote_request
    listing = qr.listing
    order = Order(order_number=_order_number(db), buyer_id=buyer.id, supplier_business_id=quotation.supplier_business_id,
                  quotation_id=quotation.id, status="pending", subtotal=quotation.total, total=quotation.total,
                  currency=quotation.currency, delivery_address=delivery_address, notes=notes)
    order.items.append(OrderItem(product_id=listing.product_id if listing else None, listing_id=listing.id if listing else None,
                                 name=qr.title, quantity=quotation.quantity, unit=qr.unit,
                                 unit_price=quotation.unit_price, line_total=quotation.total))
    db.add(order)
    db.flush()
    return order


def _get_supplier_order(db: Session, business_id: uuid.UUID, order_id: uuid.UUID, *, lock: bool = False) -> Order:
    stmt = select(Order).where(Order.id == order_id, Order.supplier_business_id == business_id).options(selectinload(Order.items))
    if lock:
        stmt = stmt.with_for_update()
    order = db.scalar(stmt)
    if order is None:
        raise NotFound("Sifariş tapılmadı")
    return order


def set_status_by_supplier(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, order_id: uuid.UUID,
                           status: str) -> Order:
    order = _get_supplier_order(db, business_id, order_id, lock=True)
    if status == order.status:
        return order  # idempotent repeat
    if status not in TRANSITIONS.get(order.status, set()):
        raise Conflict(f"Status '{order.status}' → '{status}' keçidi mümkün deyil", code="invalid_transition")
    before = order.status
    if status == "confirmed":
        for item in order.items:
            if item.product_id:
                adjust_stock(db, actor_id=actor_id, business_id=business_id, product_id=item.product_id,
                             delta=-Decimal(item.quantity), source="order", event_type="sale", order_id=order.id,
                             reason=f"Sifariş {order.order_number}", idempotency_key=f"order:{order.id}:{item.id}:sale")
        order.confirmed_at = utc_now()
    elif status == "cancelled" and before == "confirmed":
        for item in order.items:
            if item.product_id:
                adjust_stock(db, actor_id=actor_id, business_id=business_id, product_id=item.product_id,
                             delta=Decimal(item.quantity), source="order", event_type="order_cancel", order_id=order.id,
                             reason=f"Sifariş ləğvi {order.order_number}",
                             idempotency_key=f"order:{order.id}:{item.id}:cancel")
    order.status = status
    labels = {"confirmed": "təsdiqləndi", "fulfilled": "tamamlandı", "cancelled": "ləğv edildi"}
    notify_user(db, order.buyer_id, type=f"order.{status}", title=f"Sifariş {order.order_number} {labels[status]}",
                link="/buyer/orders")
    audit(db, business_id=business_id, actor_id=actor_id, action="order.status", entity_type="order", entity_id=order.id,
          before={"status": before}, after={"status": status})
    db.flush()
    return order


def cancel_by_buyer(db: Session, *, buyer: Profile, order_id: uuid.UUID) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.buyer_id == buyer.id).with_for_update())
    if order is None:
        raise NotFound("Sifariş tapılmadı")
    if order.status == "cancelled":
        return order
    if order.status != "pending":
        raise Conflict("Yalnız gözləmədə olan sifarişi ləğv edə bilərsiniz", code="invalid_transition")
    order.status = "cancelled"
    notify_business(db, order.supplier_business_id, type="order.cancelled",
                    title=f"Sifariş {order.order_number} alıcı tərəfindən ləğv edildi", link="/supplier/orders")
    audit(db, business_id=order.supplier_business_id, actor_id=buyer.id, action="order.cancel_by_buyer",
          entity_type="order", entity_id=order.id)
    db.flush()
    return order


def list_supplier_orders(db: Session, business_id: uuid.UUID, status: str | None = None) -> list[dict]:
    stmt = select(Order).where(Order.supplier_business_id == business_id).options(
        selectinload(Order.items), selectinload(Order.buyer))
    if status:
        stmt = stmt.where(Order.status == status)
    return [serialize_order(o, for_supplier=True) for o in db.scalars(stmt.order_by(Order.created_at.desc()).limit(200)).all()]


def list_buyer_orders(db: Session, buyer_id: uuid.UUID) -> list[dict]:
    stmt = select(Order).where(Order.buyer_id == buyer_id).options(selectinload(Order.items), selectinload(Order.supplier))
    return [serialize_order(o) for o in db.scalars(stmt.order_by(Order.created_at.desc()).limit(200)).all()]


def serialize_order(o: Order, *, for_supplier: bool = False) -> dict[str, Any]:
    out = {
        "id": str(o.id), "order_number": o.order_number, "status": o.status, "subtotal": money_str(o.subtotal),
        "total": money_str(o.total), "currency": o.currency, "notes": o.notes, "delivery_address": o.delivery_address,
        "created_at": iso(o.created_at), "confirmed_at": iso(o.confirmed_at),
        "quotation_id": str(o.quotation_id) if o.quotation_id else None,
        "items": [{"id": str(i.id), "name": i.name, "quantity": qty_str(i.quantity), "unit": i.unit,
                   "unit_price": money_str(i.unit_price), "line_total": money_str(i.line_total),
                   "listing_id": str(i.listing_id) if i.listing_id else None} for i in o.items],
    }
    if for_supplier:
        out["buyer"] = {"name": o.buyer.full_name or o.buyer.email, "email": o.buyer.email, "phone": o.buyer.phone,
                        "city": o.buyer.city, "company_name": o.buyer.company_name}
    else:
        out["supplier"] = {"name": o.supplier.name, "slug": o.supplier.slug, "city": o.supplier.city, "phone": o.supplier.phone}
    return out
