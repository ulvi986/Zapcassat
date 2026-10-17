"""Database schema. Money uses NUMERIC(14,2), quantities NUMERIC(14,3).

Private data (products, inventory, purchase prices, events) is always scoped by
business_id. Public marketplace data lives in marketplace_listings and is the only
thing anonymous visitors can read.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk, utcnow

MONEY = Numeric(14, 2)
QTY = Numeric(14, 3)


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


ROLES = ("supplier", "buyer")
MEMBER_ROLES = ("owner", "admin", "staff")
BUSINESS_KINDS = ("supplier", "buyer")
UNITS = ("piece", "m2", "m", "m3", "kg", "ton", "l", "pack", "set")
LISTING_STATUSES = ("draft", "active", "paused")
EVENT_TYPES = ("initial", "increase", "decrease", "set", "sale", "import", "undo", "order_cancel")
EVENT_SOURCES = ("manual", "ai", "import", "order", "undo", "system")
AI_ACTION_STATUSES = ("pending", "executed", "rejected", "failed")
QR_STATUSES = ("open", "quoted", "accepted", "declined", "cancelled")
QUOTATION_STATUSES = ("sent", "accepted", "rejected", "withdrawn")
ORDER_STATUSES = ("pending", "confirmed", "fulfilled", "cancelled")


# ---------------------------------------------------------------------------
# Identity & tenancy
# ---------------------------------------------------------------------------
class Profile(Base, Timestamps):
    """One row per authenticated user. id == Supabase auth.users.id in Supabase mode."""

    __tablename__ = "profiles"
    __table_args__ = (CheckConstraint(f"primary_role IS NULL OR {_in('primary_role', ROLES)}", name="primary_role"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(40))
    city: Mapped[str | None] = mapped_column(String(100))
    locale: Mapped[str] = mapped_column(String(8), default="az")
    primary_role: Mapped[str | None] = mapped_column(String(20))
    # Craftsman (buyer) profile details
    specialty: Mapped[str | None] = mapped_column(String(200))
    company_name: Mapped[str | None] = mapped_column(String(200))
    buyer_onboarded: Mapped[bool] = mapped_column(Boolean, default=False)

    memberships: Mapped[list[BusinessMember]] = relationship(back_populates="user", cascade="all, delete-orphan")


class LocalCredential(Base):
    """Password hashes for the local auth provider only (unused with Supabase Auth)."""

    __tablename__ = "local_credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Business(Base, UUIDPk, Timestamps):
    __tablename__ = "businesses"
    __table_args__ = (CheckConstraint(_in("kind", BUSINESS_KINDS), name="kind"),)

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="supplier")
    tax_id: Mapped[str | None] = mapped_column(String(20))  # VÖEN
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(320))
    city: Mapped[str | None] = mapped_column(String(100), index=True)
    address: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)

    members: Mapped[list[BusinessMember]] = relationship(back_populates="business", cascade="all, delete-orphan")


class BusinessMember(Base, UUIDPk):
    __tablename__ = "business_members"
    __table_args__ = (
        UniqueConstraint("business_id", "user_id", name="business_user"),
        CheckConstraint(_in("role", MEMBER_ROLES), name="role"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="owner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    business: Mapped[Business] = relationship(back_populates="members")
    user: Mapped[Profile] = relationship(back_populates="memberships")


# ---------------------------------------------------------------------------
# Catalog & inventory (private, business-scoped)
# ---------------------------------------------------------------------------
class ProductCategory(Base, UUIDPk):
    __tablename__ = "product_categories"

    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name_az: Mapped[str] = mapped_column(String(120))
    name_en: Mapped[str] = mapped_column(String(120))
    name_tr: Mapped[str] = mapped_column(String(120))
    icon: Mapped[str | None] = mapped_column(String(40))
    keywords: Mapped[str] = mapped_column(Text, default="")  # normalized keywords for auto-categorisation
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("product_categories.id"))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Product(Base, UUIDPk, Timestamps):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_id", "sku", name="business_sku"),
        CheckConstraint(_in("unit", UNITS), name="unit"),
        CheckConstraint("purchase_price IS NULL OR purchase_price >= 0", name="purchase_price_nonneg"),
        CheckConstraint("selling_price IS NULL OR selling_price >= 0", name="selling_price_nonneg"),
        CheckConstraint("low_stock_threshold >= 0", name="threshold_nonneg"),
        Index("ix_products_business_archived", "business_id", "is_archived"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("product_categories.id"))
    sku: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(250))
    description: Mapped[str | None] = mapped_column(Text)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    purchase_price: Mapped[Decimal | None] = mapped_column(MONEY)
    selling_price: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="AZN")
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=10)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    search_text: Mapped[str] = mapped_column(Text, default="")

    category: Mapped[ProductCategory | None] = relationship()
    inventory: Mapped[Inventory | None] = relationship(back_populates="product", uselist=False)
    images: Mapped[list[ProductImage]] = relationship(
        back_populates="product", order_by="ProductImage.position", cascade="all, delete-orphan"
    )


class SellerSku(Base, UUIDPk):
    """Alternative codes/aliases for a product (barcodes, supplier codes, alias names)
    used to match free-text inventory messages to existing products."""

    __tablename__ = "seller_skus"
    __table_args__ = (UniqueConstraint("business_id", "code", name="business_code"),)

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="alias")  # alias | barcode | supplier_code
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Inventory(Base, UUIDPk):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_code", name="product_warehouse"),
        CheckConstraint("quantity >= 0", name="quantity_nonneg"),
        CheckConstraint("reserved >= 0", name="reserved_nonneg"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id", ondelete="CASCADE"), index=True)
    warehouse_code: Mapped[str] = mapped_column(String(40), default="main")
    quantity: Mapped[Decimal] = mapped_column(QTY, default=Decimal("0"))
    reserved: Mapped[Decimal] = mapped_column(QTY, default=Decimal("0"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    product: Mapped[Product] = relationship(back_populates="inventory")


class InventoryEvent(Base, UUIDPk):
    """Append-only ledger of every stock change. Quantities are never silently overwritten."""

    __tablename__ = "inventory_events"
    __table_args__ = (
        CheckConstraint(_in("event_type", EVENT_TYPES), name="event_type"),
        CheckConstraint(_in("source", EVENT_SOURCES), name="source"),
        CheckConstraint("quantity_after >= 0", name="after_nonneg"),
        UniqueConstraint("business_id", "idempotency_key", name="business_idem"),
        Index("ix_inventory_events_product_created", "product_id", "created_at"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id", ondelete="CASCADE"))
    inventory_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("inventory.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(20), default="manual")
    delta: Mapped[Decimal] = mapped_column(QTY)
    quantity_before: Mapped[Decimal] = mapped_column(QTY)
    quantity_after: Mapped[Decimal] = mapped_column(QTY)
    reason: Mapped[str | None] = mapped_column(String(500))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="SET NULL"))
    ai_action_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("ai_actions.id", ondelete="SET NULL"))
    order_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("orders.id", ondelete="SET NULL"))
    reverts_event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("inventory_events.id"))
    reverted: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ProductImage(Base, UUIDPk):
    __tablename__ = "product_images"

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id", ondelete="CASCADE"), index=True)
    storage_path: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1000))
    content_type: Mapped[str] = mapped_column(String(60))
    size_bytes: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship(back_populates="images")


# ---------------------------------------------------------------------------
# Public marketplace
# ---------------------------------------------------------------------------
class MarketplaceListing(Base, UUIDPk, Timestamps):
    """Publicly visible offer derived from a private product. Never exposes purchase price."""

    __tablename__ = "marketplace_listings"
    __table_args__ = (
        UniqueConstraint("product_id", name="product"),
        CheckConstraint(_in("status", LISTING_STATUSES), name="status"),
        CheckConstraint("price >= 0", name="price_nonneg"),
        CheckConstraint("min_order_qty > 0", name="moq_positive"),
        Index("ix_listings_status_city", "status", "city"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("product_categories.id"), index=True)
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="AZN")
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    min_order_qty: Mapped[Decimal] = mapped_column(QTY, default=Decimal("1"))
    show_stock: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(10), default="active")
    city: Mapped[str | None] = mapped_column(String(100))
    search_text: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    business: Mapped[Business] = relationship()
    product: Mapped[Product] = relationship()
    category: Mapped[ProductCategory | None] = relationship()


class Favorite(Base, UUIDPk):
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", name="user_listing"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("marketplace_listings.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------------------------------------------------------------------
# AI
# ---------------------------------------------------------------------------
class Conversation(Base, UUIDPk, Timestamps):
    __tablename__ = "conversations"
    __table_args__ = (CheckConstraint(_in("mode", ROLES), name="mode"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    mode: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200), default="Yeni söhbət")


class Message(Base, UUIDPk):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(_in("role", ("user", "assistant", "tool")), name="role"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text, default="")
    blocks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # structured UI blocks
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AIAction(Base, UUIDPk):
    """A write operation proposed by the assistant. Executed only after explicit confirmation."""

    __tablename__ = "ai_actions"
    __table_args__ = (CheckConstraint(_in("status", AI_ACTION_STATUSES), name="status"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("messages.id", ondelete="SET NULL"))
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"))
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    tool_name: Mapped[str] = mapped_column(String(60))
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON)
    preview: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ---------------------------------------------------------------------------
# Quotes & orders
# ---------------------------------------------------------------------------
class QuoteRequest(Base, UUIDPk, Timestamps):
    __tablename__ = "quote_requests"
    __table_args__ = (
        CheckConstraint(_in("status", QR_STATUSES), name="status"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    buyer_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    supplier_business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("marketplace_listings.id", ondelete="SET NULL"))
    group_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)  # same request sent to several suppliers
    title: Mapped[str] = mapped_column(String(250))
    quantity: Mapped[Decimal] = mapped_column(QTY)
    unit: Mapped[str] = mapped_column(String(10), default="piece")
    city: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="open")

    buyer: Mapped[Profile] = relationship()
    supplier: Mapped[Business] = relationship()
    listing: Mapped[MarketplaceListing | None] = relationship()
    quotations: Mapped[list[Quotation]] = relationship(back_populates="quote_request", order_by="Quotation.created_at")


class Quotation(Base, UUIDPk):
    __tablename__ = "quotations"
    __table_args__ = (
        CheckConstraint(_in("status", QUOTATION_STATUSES), name="status"),
        CheckConstraint("unit_price >= 0", name="unit_price_nonneg"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    quote_request_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("quote_requests.id", ondelete="CASCADE"), index=True)
    supplier_business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="SET NULL"))
    unit_price: Mapped[Decimal] = mapped_column(MONEY)
    quantity: Mapped[Decimal] = mapped_column(QTY)
    total: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="AZN")
    delivery_days: Mapped[int | None] = mapped_column(Integer)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="sent")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    quote_request: Mapped[QuoteRequest] = relationship(back_populates="quotations")


class Order(Base, UUIDPk, Timestamps):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(_in("status", ORDER_STATUSES), name="status"),
        CheckConstraint("total >= 0", name="total_nonneg"),
        UniqueConstraint("buyer_id", "idempotency_key", name="buyer_idem"),
        Index("ix_orders_supplier_status_created", "supplier_business_id", "status", "created_at"),
    )

    order_number: Mapped[str] = mapped_column(String(30), unique=True)
    buyer_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="RESTRICT"), index=True)
    supplier_business_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="RESTRICT"))
    quotation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("quotations.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(12), default="pending")
    subtotal: Mapped[Decimal] = mapped_column(MONEY)
    total: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="AZN")
    delivery_address: Mapped[str | None] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(120))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    buyer: Mapped[Profile] = relationship()
    supplier: Mapped[Business] = relationship()
    items: Mapped[list[OrderItem]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base, UUIDPk):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_nonneg"),
    )

    order_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("products.id", ondelete="SET NULL"), index=True)
    listing_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("marketplace_listings.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(250))
    quantity: Mapped[Decimal] = mapped_column(QTY)
    unit: Mapped[str] = mapped_column(String(10))
    unit_price: Mapped[Decimal] = mapped_column(MONEY)
    line_total: Mapped[Decimal] = mapped_column(MONEY)

    order: Mapped[Order] = relationship(back_populates="items")


# ---------------------------------------------------------------------------
# Notifications, audit, idempotency
# ---------------------------------------------------------------------------
class Notification(Base, UUIDPk):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"))
    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(300))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AuditLog(Base, UUIDPk):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_business_created", "business_id", "created_at"),)

    business_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("businesses.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    via: Mapped[str] = mapped_column(String(20), default="api")  # api | ai | import | system
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IdempotencyRecord(Base, UUIDPk):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", name="user_key"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("profiles.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(120))
    scope: Mapped[str] = mapped_column(String(120))
    response: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
