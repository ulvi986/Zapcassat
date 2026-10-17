"""Product image storage: local disk (development) or Supabase Storage (production)."""

from __future__ import annotations

import uuid
from pathlib import Path

import httpx

from app.core.config import Settings
from app.core.errors import AppError, ValidationFailed

# magic bytes -> (content type, extension)
_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"RIFF", "image/webp", "webp"),  # verified further below
]


def sniff_image(content: bytes) -> tuple[str, str]:
    """Detect the real image type from the bytes; never trust the client-supplied content type."""
    for sig, ctype, ext in _SIGNATURES:
        if content.startswith(sig):
            if ctype == "image/webp" and content[8:12] != b"WEBP":
                continue
            return ctype, ext
    raise ValidationFailed("Yalnız JPEG, PNG və WEBP şəkilləri qəbul olunur", code="unsupported_file")


def store_image(settings: Settings, *, business_id: uuid.UUID, product_id: uuid.UUID, content: bytes) -> tuple[str, str, str]:
    """Returns (storage_path, public_url, content_type)."""
    if len(content) > settings.max_upload_bytes:
        raise ValidationFailed(f"Fayl həcmi {settings.max_upload_bytes // (1024 * 1024)} MB-dan çox ola bilməz",
                               code="file_too_large")
    if not content:
        raise ValidationFailed("Fayl boşdur")
    ctype, ext = sniff_image(content)
    path = f"{business_id}/{product_id}/{uuid.uuid4().hex}.{ext}"
    if settings.storage_provider == "supabase":
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise AppError("Supabase Storage konfiqurasiya olunmayıb", code="storage_not_configured", status_code=503)
        base = settings.supabase_url.rstrip("/")
        resp = httpx.post(
            f"{base}/storage/v1/object/{settings.supabase_storage_bucket}/{path}",
            content=content,
            headers={"Authorization": f"Bearer {settings.supabase_service_role_key}", "Content-Type": ctype,
                     "x-upsert": "false"},
            timeout=30,
        )
        if resp.status_code >= 300:
            raise AppError("Şəkil yüklənə bilmədi", code="storage_error", status_code=502)
        return path, f"{base}/storage/v1/object/public/{settings.supabase_storage_bucket}/{path}", ctype
    target = Path(settings.local_upload_dir) / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return path, f"{settings.public_base_url.rstrip('/')}/uploads/{path}", ctype


def delete_image(settings: Settings, storage_path: str) -> None:
    if settings.storage_provider == "supabase":
        if settings.supabase_url and settings.supabase_service_role_key:
            httpx.request(
                "DELETE",
                f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_storage_bucket}",
                json={"prefixes": [storage_path]},
                headers={"Authorization": f"Bearer {settings.supabase_service_role_key}"},
                timeout=30,
            )
        return
    target = Path(settings.local_upload_dir) / storage_path
    try:
        target.resolve().relative_to(Path(settings.local_upload_dir).resolve())
    except ValueError:
        return
    target.unlink(missing_ok=True)
