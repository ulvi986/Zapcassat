from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import DB, CurrentUser, SettingsDep, rate_limit
from app.schemas.requests import BuyerOnboardingIn, LoginIn, ProfileUpdateIn, RegisterIn, SupplierOnboardingIn
from app.services import accounts

router = APIRouter(tags=["auth"])


@router.get("/auth/config")
def auth_config(settings: SettingsDep):
    return {"provider": settings.auth_provider}


@router.post("/auth/register", status_code=201, dependencies=[Depends(rate_limit)])
def register(body: RegisterIn, db: DB, settings: SettingsDep):
    profile, token = accounts.register_local(db, settings, email=body.email, password=body.password, full_name=body.full_name)
    return {"access_token": token, "token_type": "bearer", "user": accounts.serialize_me(db, profile)}


@router.post("/auth/login", dependencies=[Depends(rate_limit)])
def login(body: LoginIn, db: DB, settings: SettingsDep):
    profile, token = accounts.login_local(db, settings, email=body.email, password=body.password)
    return {"access_token": token, "token_type": "bearer", "user": accounts.serialize_me(db, profile)}


@router.get("/me")
def me(db: DB, user: CurrentUser):
    return accounts.serialize_me(db, user)


@router.patch("/me")
def update_me(body: ProfileUpdateIn, db: DB, user: CurrentUser):
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    return accounts.serialize_me(db, user)


@router.post("/onboarding/supplier", status_code=201)
def onboard_supplier(body: SupplierOnboardingIn, db: DB, user: CurrentUser):
    accounts.onboard_supplier(db, user, body.model_dump())
    return accounts.serialize_me(db, user)


@router.post("/onboarding/buyer")
def onboard_buyer(body: BuyerOnboardingIn, db: DB, user: CurrentUser):
    accounts.onboard_buyer(db, user, body.model_dump())
    return accounts.serialize_me(db, user)
