from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import Unauthorized
from app.core.rate_limit import limiter
from app.core.security import verify_token
from app.db.session import get_db
from app.models import Profile
from app.services.accounts import Membership, get_or_provision_profile, require_member

DB = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else None) or (request.client.host if request.client else "unknown")


def rate_limit(request: Request, settings: SettingsDep) -> None:
    limiter.hit(f"ip:{_client_key(request)}", settings.rate_limit_per_minute)


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def current_user(db: DB, settings: SettingsDep, authorization: Annotated[str | None, Header()] = None) -> Profile:
    token = _bearer(authorization)
    if not token:
        raise Unauthorized("Daxil olmaq tələb olunur")
    ident = verify_token(settings, token)
    return get_or_provision_profile(db, ident.user_id, ident.email, allow_provision=settings.auth_provider == "supabase")


def optional_user(db: DB, settings: SettingsDep, authorization: Annotated[str | None, Header()] = None) -> Profile | None:
    if not _bearer(authorization):
        return None
    try:
        return current_user(db, settings, authorization)
    except Unauthorized:
        return None


CurrentUser = Annotated[Profile, Depends(current_user)]
OptionalUser = Annotated[Profile | None, Depends(optional_user)]


def supplier_membership(business_id: uuid.UUID, db: DB, user: CurrentUser) -> Membership:
    return require_member(db, user.id, business_id)


SupplierMember = Annotated[Membership, Depends(supplier_membership)]
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key")]
