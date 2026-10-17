"""Users, businesses, memberships and onboarding."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import Conflict, Forbidden, NotFound, Unauthorized, ValidationFailed
from app.core.security import hash_password, issue_local_token, verify_password
from app.models import Business, BusinessMember, LocalCredential, Profile
from app.services.common import audit, unique_slug


@dataclass
class Membership:
    business: Business
    role: str


def register_local(db: Session, settings: Settings, *, email: str, password: str, full_name: str | None) -> tuple[Profile, str]:
    if settings.auth_provider != "local":
        raise Forbidden("Qeydiyyat Supabase Auth vasitəsilə aparılır")
    email = email.strip().lower()
    if db.scalar(select(Profile.id).where(Profile.email == email)):
        raise Conflict("Bu e-poçt artıq qeydiyyatdan keçib", code="email_taken")
    profile = Profile(email=email, full_name=(full_name or "").strip() or None)
    db.add(profile)
    db.flush()
    db.add(LocalCredential(user_id=profile.id, password_hash=hash_password(password)))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("Bu e-poçt artıq qeydiyyatdan keçib", code="email_taken") from exc
    return profile, issue_local_token(settings, profile.id, profile.email)


def login_local(db: Session, settings: Settings, *, email: str, password: str) -> tuple[Profile, str]:
    if settings.auth_provider != "local":
        raise Forbidden("Giriş Supabase Auth vasitəsilə aparılır")
    profile = db.scalar(select(Profile).where(Profile.email == email.strip().lower()))
    cred = db.get(LocalCredential, profile.id) if profile else None
    if not profile or not cred or not verify_password(password, cred.password_hash):
        raise Unauthorized("E-poçt və ya şifrə yanlışdır", code="invalid_credentials")
    return profile, issue_local_token(settings, profile.id, profile.email)


def get_or_provision_profile(db: Session, user_id: uuid.UUID, email: str | None, *, allow_provision: bool) -> Profile:
    profile = db.get(Profile, user_id)
    if profile:
        return profile
    if not allow_provision or not email:
        raise Unauthorized("İstifadəçi tapılmadı")
    # First request from a Supabase-authenticated user: mirror into profiles.
    profile = Profile(id=user_id, email=email.lower())
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        profile = db.get(Profile, user_id)
        if profile is None:
            raise Conflict("Bu e-poçt başqa hesaba bağlıdır") from None
    return profile


def memberships(db: Session, user_id: uuid.UUID) -> list[Membership]:
    rows = db.execute(
        select(Business, BusinessMember.role)
        .join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(BusinessMember.user_id == user_id)
        .order_by(BusinessMember.created_at)
    ).all()
    return [Membership(business=b, role=r) for b, r in rows]


def require_member(db: Session, user_id: uuid.UUID, business_id: uuid.UUID, *, roles: tuple[str, ...] | None = None,
                   kind: str | None = "supplier") -> Membership:
    """Central tenant guard. Every business-scoped operation goes through this."""
    row = db.execute(
        select(Business, BusinessMember.role)
        .join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(BusinessMember.user_id == user_id, Business.id == business_id)
    ).first()
    if row is None:
        # Do not reveal whether the business exists.
        raise NotFound("Biznes tapılmadı")
    business, role = row
    if kind and business.kind != kind:
        raise Forbidden("Bu əməliyyat yalnız topdansatıcılar üçündür")
    if roles and role not in roles:
        raise Forbidden("Bu əməliyyat üçün icazəniz yoxdur")
    return Membership(business=business, role=role)


def onboard_supplier(db: Session, profile: Profile, data: dict) -> Business:
    if any(m.business.kind == "supplier" for m in memberships(db, profile.id)) and not data.get("allow_additional"):
        raise Conflict("Artıq topdansatıcı biznesiniz var", code="already_onboarded")
    name = data["business_name"].strip()
    if len(name) < 2:
        raise ValidationFailed("Biznes adı ən azı 2 simvol olmalıdır")
    business = Business(
        name=name,
        slug=unique_slug(db, Business, name),
        kind="supplier",
        tax_id=data.get("tax_id"),
        phone=data.get("phone"),
        email=data.get("email") or profile.email,
        city=data.get("city"),
        address=data.get("address"),
        description=data.get("description"),
    )
    db.add(business)
    db.flush()
    db.add(BusinessMember(business_id=business.id, user_id=profile.id, role="owner"))
    if data.get("full_name"):
        profile.full_name = data["full_name"]
    if data.get("phone") and not profile.phone:
        profile.phone = data["phone"]
    profile.primary_role = "supplier"
    audit(db, business_id=business.id, actor_id=profile.id, action="business.create", entity_type="business",
          entity_id=business.id, after={"name": business.name, "city": business.city})
    db.commit()
    return business


CRAFTSMAN_SPECIALTY = "Maşın ustası"


def onboard_buyer(db: Session, profile: Profile, data: dict) -> Profile:
    data = {**data, "specialty": data.get("specialty") or profile.specialty or CRAFTSMAN_SPECIALTY}
    for field in ("full_name", "phone", "city", "specialty", "company_name"):
        if data.get(field) is not None:
            setattr(profile, field, data[field])
    profile.buyer_onboarded = True
    if profile.primary_role is None:
        profile.primary_role = "buyer"
    db.commit()
    return profile


def update_business(db: Session, actor: Profile, business: Business, data: dict) -> Business:
    before = {k: getattr(business, k) for k in data}
    for k, v in data.items():
        setattr(business, k, v)
    audit(db, business_id=business.id, actor_id=actor.id, action="business.update", entity_type="business",
          entity_id=business.id, before=before, after=data)
    db.commit()
    return business


def serialize_business(b: Business, *, private: bool = False) -> dict:
    out = {
        "id": str(b.id), "name": b.name, "slug": b.slug, "kind": b.kind, "city": b.city,
        "description": b.description, "verified": b.verified, "created_at": b.created_at.isoformat(),
        "phone": b.phone, "email": b.email, "address": b.address,
    }
    if private:
        out["tax_id"] = b.tax_id
    return out


def serialize_me(db: Session, profile: Profile) -> dict:
    ms = memberships(db, profile.id)
    roles = []
    if any(m.business.kind == "supplier" for m in ms):
        roles.append("supplier")
    if profile.buyer_onboarded:
        roles.append("buyer")
    return {
        "id": str(profile.id),
        "email": profile.email,
        "full_name": profile.full_name,
        "phone": profile.phone,
        "city": profile.city,
        "locale": profile.locale,
        "specialty": profile.specialty,
        "company_name": profile.company_name,
        "primary_role": profile.primary_role,
        "roles": roles,
        "onboarded": bool(roles),
        "memberships": [{"role": m.role, "business": serialize_business(m.business, private=True)} for m in ms],
    }
