"""Token issuing/verification for the two supported auth providers."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import Settings
from app.core.errors import Unauthorized

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


@dataclass(frozen=True)
class TokenIdentity:
    user_id: uuid.UUID
    email: str | None


def issue_local_token(settings: Settings, user_id: uuid.UUID, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_ttl_minutes),
        "iss": "zapcastsat-local",
        "aud": "authenticated",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def verify_token(settings: Settings, token: str) -> TokenIdentity:
    try:
        if settings.auth_provider == "local":
            claims = jwt.decode(
                token, settings.jwt_secret, algorithms=["HS256"], audience="authenticated", issuer="zapcastsat-local"
            )
        elif settings.supabase_jwt_secret:
            claims = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        else:
            if not settings.supabase_url:
                raise Unauthorized("Supabase auth is not configured (SUPABASE_URL missing)")
            client = _jwks_client(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")
            key = client.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated")
        return TokenIdentity(user_id=uuid.UUID(claims["sub"]), email=claims.get("email"))
    except Unauthorized:
        raise
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise Unauthorized("Invalid or expired token") from exc
