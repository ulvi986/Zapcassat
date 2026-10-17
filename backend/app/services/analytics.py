"""Supplier analytics, computed only from real records (orders, inventory, quote requests)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventoryEvent, Order, OrderItem, Product, ProductCategory, QuoteRequest
from app.services.common import aware, iso, money_str, qty_str, utc_now
from app.services.inventory import summary as inventory_summary
from app.services.products import inventory_value

REVENUE_STATUSES = ("confirmed", "fulfilled")


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _revenue_date(o: Order) -> datetime:
    return aware(o.confirmed_at or o.created_at)


def overview(db: Session, business_id: uuid.UUID, *, days: int = 30) -> dict[str, Any]:
    now = utc_now()
    days = max(7, min(days, 365))
    since = now - timedelta(days=days)
    inv = inventory_summary(db, business_id)

    rev_orders = db.scalars(
        select(Order).where(Order.supplier_business_id == business_id, Order.status.in_(REVENUE_STATUSES))
    ).all()
    month_start = _month_start(now)
    prev_month_start = _month_start(month_start - timedelta(days=1))
    monthly_revenue = sum((Decimal(o.total) for o in rev_orders if _revenue_date(o) >= month_start), Decimal(0))
    prev_month_revenue = sum(
        (Decimal(o.total) for o in rev_orders if prev_month_start <= _revenue_date(o) < month_start), Decimal(0)
    )

    active_orders = db.scalar(select(func.count()).select_from(Order).where(
        Order.supplier_business_id == business_id, Order.status.in_(("pending", "confirmed")))) or 0
    pending_quotes = db.scalar(select(func.count()).select_from(QuoteRequest).where(
        QuoteRequest.supplier_business_id == business_id, QuoteRequest.status == "open")) or 0

    revenue_by_day: dict[date, Decimal] = defaultdict(Decimal)
    orders_by_day: dict[date, int] = defaultdict(int)
    for o in rev_orders:
        d = _revenue_date(o)
        if d >= since:
            revenue_by_day[d.date()] += Decimal(o.total)
            orders_by_day[d.date()] += 1
    volume_rows = db.execute(
        select(Order.confirmed_at, Order.created_at, OrderItem.quantity)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.supplier_business_id == business_id, Order.status.in_(REVENUE_STATUSES))
    ).all()
    volume_by_day: dict[date, Decimal] = defaultdict(Decimal)
    for confirmed_at, created_at, q in volume_rows:
        d = aware(confirmed_at or created_at)
        if d >= since:
            volume_by_day[d.date()] += Decimal(q)
    series = []
    for i in range(days, -1, -1):
        d = (now - timedelta(days=i)).date()
        series.append({"date": d.isoformat(), "revenue": money_str(revenue_by_day.get(d, Decimal(0))),
                       "units": qty_str(volume_by_day.get(d, Decimal(0))), "orders": orders_by_day.get(d, 0)})

    top_rows = db.execute(
        select(OrderItem.name, func.sum(OrderItem.line_total), func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.supplier_business_id == business_id, Order.status.in_(REVENUE_STATUSES), Order.created_at >= since)
        .group_by(OrderItem.name)
        .order_by(func.sum(OrderItem.line_total).desc())
        .limit(5)
    ).all()
    top_products = [{"name": n, "revenue": money_str(Decimal(r or 0)), "units": qty_str(Decimal(u or 0))} for n, r, u in top_rows]

    products = db.scalars(select(Product).where(Product.business_id == business_id, Product.is_archived.is_(False))).all()
    cat_names = {c.id: c.name_az for c in db.scalars(select(ProductCategory)).all()}
    by_cat: dict[str, dict[str, Any]] = {}
    for p in products:
        name = cat_names.get(p.category_id, "Kateqoriyasız")
        entry = by_cat.setdefault(name, {"category": name, "value": Decimal(0), "products": 0})
        entry["value"] += inventory_value(p)
        entry["products"] += 1
    categories = sorted(
        ({"category": v["category"], "value": money_str(v["value"]), "products": v["products"]} for v in by_cat.values()),
        key=lambda x: -Decimal(x["value"]),
    )

    recent_orders = db.scalars(
        select(Order).where(Order.supplier_business_id == business_id).order_by(Order.created_at.desc()).limit(6)
    ).all()
    recent_events = db.execute(
        select(InventoryEvent, Product.name, Product.unit).join(Product, Product.id == InventoryEvent.product_id)
        .where(InventoryEvent.business_id == business_id).order_by(InventoryEvent.created_at.desc()).limit(8)
    ).all()

    return {
        "period_days": days,
        "metrics": {
            "total_products": inv["total_products"],
            "total_units": inv["total_units"],
            "inventory_value": inv["inventory_value"],
            "monthly_revenue": money_str(monthly_revenue),
            "previous_month_revenue": money_str(prev_month_revenue),
            "active_orders": active_orders,
            "pending_quotations": pending_quotes,
            "low_stock_products": inv["low_stock_count"],
            "out_of_stock_products": inv["out_of_stock_count"],
        },
        "series": series,
        "has_sales": any(Decimal(r["revenue"]) > 0 for r in series),
        "top_products": top_products,
        "categories": categories,
        "low_stock": inv["low_stock"],
        "recent_orders": [{"id": str(o.id), "order_number": o.order_number, "status": o.status,
                           "total": money_str(o.total), "created_at": iso(o.created_at)} for o in recent_orders],
        "recent_inventory_events": [
            {"id": str(e.id), "product_name": n, "unit": u, "event_type": e.event_type, "delta": qty_str(e.delta),
             "quantity_after": qty_str(e.quantity_after), "source": e.source, "created_at": iso(e.created_at)}
            for e, n, u in recent_events
        ],
    }


def sales_analytics(db: Session, business_id: uuid.UUID, *, metric: str = "top_revenue", days: int = 30,
                    limit: int = 10) -> dict[str, Any]:
    """Backs the AI tool get_sales_analytics. metric: top_revenue | top_units | unsold."""
    since = utc_now() - timedelta(days=max(1, min(days, 365)))
    if metric == "unsold":
        sold_ids = set(db.scalars(
            select(OrderItem.product_id).join(Order, Order.id == OrderItem.order_id)
            .where(Order.supplier_business_id == business_id, Order.status.in_(REVENUE_STATUSES), Order.created_at >= since)
        ).all())
        products = db.scalars(select(Product).where(Product.business_id == business_id, Product.is_archived.is_(False))).all()
        unsold = sorted((p for p in products if p.id not in sold_ids), key=lambda p: -inventory_value(p))
        return {"metric": "unsold", "days": days, "items": [
            {"id": str(p.id), "name": p.name, "sku": p.sku, "quantity": qty_str(p.inventory.quantity if p.inventory else 0),
             "unit": p.unit, "inventory_value": money_str(inventory_value(p))} for p in unsold[:limit]]}
    rows = db.execute(
        select(OrderItem.product_id, OrderItem.name, func.sum(OrderItem.line_total), func.sum(OrderItem.quantity),
               func.count(func.distinct(Order.id)))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.supplier_business_id == business_id, Order.status.in_(REVENUE_STATUSES), Order.created_at >= since)
        .group_by(OrderItem.product_id, OrderItem.name)
    ).all()
    items = [{"product_id": str(pid) if pid else None, "name": n, "revenue": money_str(Decimal(r or 0)),
              "units": qty_str(Decimal(u or 0)), "orders": c} for pid, n, r, u, c in rows]
    items.sort(key=(lambda x: -Decimal(x["units"])) if metric == "top_units" else (lambda x: -Decimal(x["revenue"])))
    total = sum((Decimal(i["revenue"]) for i in items), Decimal(0))
    return {"metric": metric, "days": days, "total_revenue": money_str(total), "items": items[:limit]}
