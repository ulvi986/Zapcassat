"""Request bodies (validated at the API boundary)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Unit = Literal["piece", "m2", "m", "m3", "kg", "ton", "l", "pack", "set"]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterIn(Body):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=200)


class LoginIn(Body):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class SupplierOnboardingIn(Body):
    business_name: str = Field(min_length=2, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)
    tax_id: str | None = Field(default=None, max_length=20, pattern=r"^\d{10}$")
    phone: str = Field(min_length=5, max_length=40)
    email: EmailStr | None = None
    city: str = Field(min_length=2, max_length=100)
    address: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=2000)


class BuyerOnboardingIn(Body):
    """ZapCastSat is for car mechanics only, so becoming a buyer needs no extra answers.
    Phone and city can be added later in the profile settings."""

    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    phone: str | None = Field(default=None, min_length=5, max_length=40)
    city: str | None = Field(default=None, min_length=2, max_length=100)
    specialty: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)


class ProfileUpdateIn(Body):
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    city: str | None = Field(default=None, max_length=100)
    specialty: str | None = Field(default=None, max_length=200)
    company_name: str | None = Field(default=None, max_length=200)
    locale: Literal["az", "en", "tr"] | None = None


class BusinessUpdateIn(Body):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    tax_id: str | None = Field(default=None, max_length=20, pattern=r"^\d{10}$")
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    city: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=2000)


class ProductCreateIn(Body):
    name: str = Field(min_length=2, max_length=250)
    sku: str | None = Field(default=None, max_length=64)
    category_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=5000)
    attributes: dict[str, str] = Field(default_factory=dict)
    unit: Unit = "piece"
    purchase_price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    selling_price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    currency: Literal["AZN"] = "AZN"
    low_stock_threshold: int = Field(default=10, ge=0, le=10_000_000)
    quantity: Decimal = Field(default=Decimal(0), ge=0, le=Decimal("1e10"))
    aliases: list[str] = Field(default_factory=list, max_length=20)
    publish: bool = True  # put it on the marketplace right away (needs a selling price)


class ProductUpdateIn(Body):
    name: str | None = Field(default=None, min_length=2, max_length=250)
    sku: str | None = Field(default=None, max_length=64)
    category_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=5000)
    attributes: dict[str, str] | None = None
    unit: Unit | None = None
    purchase_price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    selling_price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    low_stock_threshold: int | None = Field(default=None, ge=0, le=10_000_000)


class BulkIdsIn(Body):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    archived: bool = True


class StockAdjustIn(Body):
    delta: Decimal | None = Field(default=None, ge=Decimal("-1e10"), le=Decimal("1e10"))
    set_quantity: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    reason: str | None = Field(default=None, max_length=500)
    expected_version: int | None = None


class ListingIn(Body):
    product_id: uuid.UUID
    title: str | None = Field(default=None, max_length=250)
    description: str | None = Field(default=None, max_length=5000)
    price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    min_order_qty: Decimal | None = Field(default=None, gt=0, le=Decimal("1e10"))
    show_stock: bool | None = None
    city: str | None = Field(default=None, max_length=100)
    status: Literal["draft", "active", "paused"] | None = "active"


class ListingUpdateIn(Body):
    title: str | None = Field(default=None, max_length=250)
    description: str | None = Field(default=None, max_length=5000)
    price: Decimal | None = Field(default=None, ge=0, le=Decimal("1e10"))
    min_order_qty: Decimal | None = Field(default=None, gt=0, le=Decimal("1e10"))
    show_stock: bool | None = None
    city: str | None = Field(default=None, max_length=100)
    status: Literal["draft", "active", "paused"] | None = None


class QuoteRequestIn(Body):
    listing_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    supplier_business_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    title: str | None = Field(default=None, max_length=250)
    quantity: Decimal = Field(gt=0, le=Decimal("1e10"))
    unit: Unit | None = None
    city: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


class QuotationIn(Body):
    unit_price: Decimal = Field(ge=0, le=Decimal("1e10"))
    quantity: Decimal | None = Field(default=None, gt=0, le=Decimal("1e10"))
    delivery_days: int | None = Field(default=None, ge=0, le=365)
    valid_days: int = Field(default=7, ge=1, le=90)
    notes: str | None = Field(default=None, max_length=2000)


class DeclineIn(Body):
    reason: str | None = Field(default=None, max_length=500)


class AcceptQuotationIn(Body):
    delivery_address: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)


class OrderIn(Body):
    listing_id: uuid.UUID
    quantity: Decimal = Field(gt=0, le=Decimal("1e10"))
    delivery_address: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=2000)


class OrderStatusIn(Body):
    status: Literal["confirmed", "fulfilled", "cancelled"]


class ConversationIn(Body):
    mode: Literal["supplier", "buyer"]
    business_id: uuid.UUID | None = None


class ChatMessageIn(Body):
    content: str = Field(min_length=1, max_length=4000)


class ConfirmActionIn(Body):
    overrides: dict[str, Any] | None = None


class SmartSearchIn(Body):
    query: str = Field(min_length=1, max_length=300)
    quantity: Decimal | None = Field(default=None, gt=0)
    city: str | None = Field(default=None, max_length=60)
    max_price: Decimal | None = Field(default=None, ge=0)
