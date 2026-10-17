"""Stock ledger. Every quantity change is a row in inventory_events, executed under a row lock.

Mutating functions flush but never commit; callers own the transaction."""

from __future__ import annotations

import csv
import io
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import Inventory, InventoryEvent, Product
from app.services.common import audit, iso, money_str, qty, qty_str


def _lock_inventory(db: Session, business_id: uuid.UUID, product_id: uuid.UUID) -> Inventory:
    inv = db.scalar(
        select(Inventory)
        .where(Inventory.business_id == business_id, Inventory.product_id == product_id, Inventory.warehouse_code == "main")
        .with_for_update()
    )
    if inv is None:
        raise NotFound("Məhsul tapılmadı")
    return inv


def adjust_stock(
    db: Session,
    *,
    actor_id: uuid.UUID | None,
    business_id: uuid.UUID,
    product_id: uuid.UUID,
    delta: Any = None,
    set_to: Any = None,
    reason: str | None = None,
    source: str = "manual",
    event_type: str | None = None,
    ai_action_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
    idempotency_key: str | None = None,
    expected_version: int | None = None,
) -> InventoryEvent:
    if (delta is None) == (set_to is None):
        raise ValidationFailed("Ya dəyişiklik (delta), ya da yeni miqdar göstərilməlidir")
    if idempotency_key:
        prior = db.scalar(
            select(InventoryEvent).where(InventoryEvent.business_id == business_id,
                                         InventoryEvent.idempotency_key == idempotency_key)
        )
        if prior:
            return prior
    inv = _lock_inventory(db, business_id, product_id)
    if expected_version is not None and inv.version != expected_version:
        raise Conflict("Bu məhsulun stoku başqa istifadəçi tərəfindən dəyişdirilib. Səhifəni yeniləyin.",
                       code="stale_version", details={"current_version": inv.version})
    before = Decimal(inv.quantity)
    if set_to is not None:
        after = qty(set_to)
        change = after - before
        etype = event_type or "set"
    else:
        change = qty(delta)
        after = before + change
        etype = event_type or ("increase" if change >= 0 else "decrease")
    if after < 0:
        raise ValidationFailed(
            f"Stok kifayət etmir: mövcud {qty_str(before)}, tələb olunan azalma {qty_str(-change)}",
            code="insufficient_stock",
            details={"available": qty_str(before), "requested": qty_str(-change)},
        )
    if change == 0:
        raise ValidationFailed("Miqdar dəyişmir", code="no_change")
    inv.quantity = after
    inv.version += 1
    event = InventoryEvent(
        business_id=business_id, product_id=product_id, inventory_id=inv.id, event_type=etype, source=source,
        delta=change, quantity_before=before, quantity_after=after, reason=(reason or None) and reason[:500],
        actor_id=actor_id, ai_action_id=ai_action_id, order_id=order_id, idempotency_key=idempotency_key,
    )
    db.add(event)
    audit(db, business_id=business_id, actor_id=actor_id, action="inventory.adjust", entity_type="product",
          entity_id=product_id, before={"quantity": before}, after={"quantity": after, "reason": reason},
          via={"ai": "ai", "import": "import", "order": "system"}.get(source, "api"))
    db.flush()
    return event


def undo_event(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, event_id: uuid.UUID) -> InventoryEvent:
    """Revert a manual/AI/import adjustment with a compensating event. Only the latest event of a product is undoable."""
    ev = db.scalar(select(InventoryEvent).where(InventoryEvent.id == event_id, InventoryEvent.business_id == business_id))
    if ev is None:
        raise NotFound("Hadisə tapılmadı")
    if ev.reverted or ev.event_type in ("undo", "sale", "order_cancel"):
        raise Conflict("Bu dəyişiklik geri qaytarıla bilməz", code="not_undoable")
    latest = db.scalar(
        select(InventoryEvent).where(InventoryEvent.product_id == ev.product_id)
        .order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc()).limit(1)
    )
    if latest is None or latest.id != ev.id:
        raise Conflict("Yalnız məhsulun son stok dəyişikliyi geri qaytarıla bilər", code="not_latest")
    undo = adjust_stock(db, actor_id=actor_id, business_id=business_id, product_id=ev.product_id, delta=-ev.delta,
                        reason="Geri qaytarma", source="undo", event_type="undo")
    undo.reverts_event_id = ev.id
    ev.reverted = True
    db.flush()
    return undo


def list_events(db: Session, business_id: uuid.UUID, *, product_id: uuid.UUID | None = None, limit: int = 50) -> list[dict]:
    stmt = (
        select(InventoryEvent, Product.name, Product.unit)
        .join(Product, Product.id == InventoryEvent.product_id)
        .where(InventoryEvent.business_id == business_id)
    )
    if product_id:
        stmt = stmt.where(InventoryEvent.product_id == product_id)
    rows = db.execute(stmt.order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc()).limit(min(limit, 200))).all()
    latest_by_product: dict[uuid.UUID, uuid.UUID] = {}
    for pid, eid in db.execute(
        select(InventoryEvent.product_id, InventoryEvent.id)
        .where(InventoryEvent.business_id == business_id)
        .order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc())
    ):
        latest_by_product.setdefault(pid, eid)
    return [serialize_event(ev, name, unit, undoable=(latest_by_product.get(ev.product_id) == ev.id and not ev.reverted
                                                    and ev.event_type not in ("undo", "sale", "order_cancel")))
            for ev, name, unit in rows]


def serialize_event(ev: InventoryEvent, product_name: str | None = None, unit: str | None = None, undoable: bool = False) -> dict:
    return {
        "id": str(ev.id), "product_id": str(ev.product_id), "product_name": product_name, "unit": unit,
        "event_type": ev.event_type, "source": ev.source, "delta": qty_str(ev.delta),
        "quantity_before": qty_str(ev.quantity_before), "quantity_after": qty_str(ev.quantity_after),
        "reason": ev.reason, "reverted": ev.reverted, "undoable": undoable, "created_at": iso(ev.created_at),
    }


def summary(db: Session, business_id: uuid.UUID) -> dict[str, Any]:
    from app.services.products import inventory_value, stock_status

    products = db.scalars(
        select(Product).where(Product.business_id == business_id, Product.is_archived.is_(False))
    ).all()
    total_units = Decimal(0)
    total_value = Decimal(0)
    low: list[dict] = []
    out = 0
    for p in products:
        q = Decimal(p.inventory.quantity) if p.inventory else Decimal(0)
        total_units += q
        total_value += inventory_value(p)
        st = stock_status(q, p.low_stock_threshold)
        if st == "out_of_stock":
            out += 1
        if st in ("low", "out_of_stock"):
            low.append({"id": str(p.id), "name": p.name, "sku": p.sku, "quantity": qty_str(q), "unit": p.unit,
                        "threshold": p.low_stock_threshold, "status": st})
    low.sort(key=lambda x: Decimal(x["quantity"]))
    return {
        "total_products": len(products),
        "total_units": qty_str(total_units),
        "inventory_value": money_str(total_value),
        "low_stock_count": len(low),
        "out_of_stock_count": out,
        "low_stock": low[:20],
    }


# ---------------------------------------------------------------------------
# CSV / XLSX import & export
# ---------------------------------------------------------------------------
EXPORT_COLUMNS = ["sku", "name", "category", "quantity", "unit", "purchase_price", "selling_price", "currency",
                  "inventory_value", "stock_status", "low_stock_threshold", "updated_at"]


def export_rows(db: Session, business_id: uuid.UUID) -> list[dict]:
    from app.services.products import list_products, serialize_product

    items, _ = list_products(db, business_id, page_size=500, sort="name")
    rows = []
    for p in items:
        s = serialize_product(p)
        rows.append({**{k: s.get(k) for k in EXPORT_COLUMNS}, "category": (s["category"] or {}).get("name_az", "")})
    return rows


def export_csv(db: Session, business_id: uuid.UUID) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS)
    w.writeheader()
    for r in export_rows(db, business_id):
        w.writerow(r)
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM so Excel opens UTF-8 correctly


def export_xlsx(db: Session, business_id: uuid.UUID) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Inventar"
    ws.append(EXPORT_COLUMNS)
    for r in export_rows(db, business_id):
        row = []
        for c in EXPORT_COLUMNS:
            v = r.get(c)
            if c in ("quantity", "purchase_price", "selling_price", "inventory_value") and v is not None:
                v = float(v)
            row.append(v)
        ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


_HEADER_ALIASES = {
    "sku": "sku", "kod": "sku", "name": "name", "ad": "name", "məhsul": "name", "mehsul": "name", "məhsul adı": "name",
    "quantity": "quantity", "miqdar": "quantity", "say": "quantity", "unit": "unit", "vahid": "unit",
    "purchase_price": "purchase_price", "alış qiyməti": "purchase_price", "alis qiymeti": "purchase_price",
    "selling_price": "selling_price", "satış qiyməti": "selling_price", "satis qiymeti": "selling_price",
    "qiymət": "selling_price", "price": "selling_price", "low_stock_threshold": "low_stock_threshold",
    "description": "description", "təsvir": "description",
}


def parse_upload(filename: str, content: bytes) -> list[dict[str, str]]:
    name = filename.lower()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        header = [str(h or "").strip() for h in rows[0]]
        raw = [{header[i]: ("" if v is None else str(v)) for i, v in enumerate(r) if i < len(header)} for r in rows[1:]]
    elif name.endswith(".csv") or name.endswith(".txt"):
        text = content.decode("utf-8-sig", errors="replace")
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t") if text.strip() else csv.excel
        raw = list(csv.DictReader(io.StringIO(text), dialect=dialect))
    else:
        raise ValidationFailed("Yalnız .csv və .xlsx faylları dəstəklənir")
    out = []
    for r in raw:
        mapped = {}
        for k, v in r.items():
            if k is None:
                continue
            key = _HEADER_ALIASES.get(k.strip().lower())
            if key:
                mapped[key] = (v or "").strip()
        if any(mapped.values()):
            out.append(mapped)
    if len(out) > 2000:
        raise ValidationFailed("Bir dəfəyə ən çox 2000 sətir idxal edilə bilər")
    return out


def import_rows(db: Session, *, actor_id: uuid.UUID, business_id: uuid.UUID, rows: list[dict[str, str]],
                dry_run: bool) -> dict[str, Any]:
    """Upsert by SKU (or exact name). Existing products get their quantity *set* via a ledger event."""
    from app.services.products import create_product, update_product

    results = []
    created = updated = errors = 0
    for idx, r in enumerate(rows, start=2):
        try:
            if not r.get("name") and not r.get("sku"):
                raise ValidationFailed("Ad və ya SKU tələb olunur")
            product = None
            if r.get("sku"):
                product = db.scalar(select(Product).where(Product.business_id == business_id, Product.sku == r["sku"]))
            if product is None and r.get("name"):
                product = db.scalar(select(Product).where(Product.business_id == business_id,
                                                          func.lower(Product.name) == r["name"].lower()))
            fields: dict[str, Any] = {}
            for f in ("name", "unit", "purchase_price", "selling_price", "description", "low_stock_threshold"):
                if r.get(f):
                    fields[f] = r[f]
            if "unit" in fields:
                from app.services.lexicon import parse_unit

                fields["unit"] = parse_unit(fields["unit"]) or fields["unit"]
            q = qty(r["quantity"]) if r.get("quantity") else None
            if q is not None and q < 0:
                raise ValidationFailed("Miqdar mənfi ola bilməz")
            with db.begin_nested():
                if product is None:
                    if r.get("sku"):
                        fields["sku"] = r["sku"]
                    create_product(db, actor_id=actor_id, business_id=business_id, data=fields,
                                   initial_quantity=q or 0, via="import")
                    action = "create"
                    created += 1
                else:
                    update_product(db, actor_id=actor_id, product=product, data=fields, via="import")
                    if q is not None and product.inventory and Decimal(product.inventory.quantity) != q:
                        adjust_stock(db, actor_id=actor_id, business_id=business_id, product_id=product.id,
                                     set_to=q, source="import", event_type="import", reason="Fayldan idxal")
                    action = "update"
                    updated += 1
            results.append({"row": idx, "status": "ok", "action": action, "name": r.get("name") or r.get("sku")})
        except Exception as exc:  # report per-row problems instead of failing the whole file
            errors += 1
            msg = getattr(exc, "message", None) or str(exc)
            results.append({"row": idx, "status": "error", "error": msg, "name": r.get("name") or r.get("sku")})
    if dry_run:
        db.rollback()
    return {"dry_run": dry_run, "created": created, "updated": updated, "errors": errors, "rows": results}
