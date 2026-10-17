"""Application settings, loaded from environment variables (see .env.example)."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ZapCastSat AI"
    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"

    # Database. SQLite is the zero-config development default; production uses Supabase Postgres.
    database_url: str = "sqlite:///./zapcastsat_dev.db"

    # CORS
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])

    # --- Authentication ---
    # "local": the backend issues its own JWTs (development / self-hosted).
    # "supabase": the backend verifies Supabase Auth access tokens.
    auth_provider: Literal["local", "supabase"] = "local"
    jwt_secret: str = "dev-insecure-change-me-please-32bytes!!"
    jwt_ttl_minutes: int = 60 * 24 * 7
    supabase_url: str | None = None
    supabase_jwt_secret: str | None = None  # legacy HS256 secret; JWKS is used when absent
    supabase_service_role_key: str | None = None
    supabase_storage_bucket: str = "product-images"

    # --- Storage ---
    storage_provider: Literal["local", "supabase"] = "local"
    local_upload_dir: str = "./uploads"
    public_base_url: str = "http://localhost:8000"
    max_upload_bytes: int = 5 * 1024 * 1024

    # --- AI ---
    # When llm_api_key is empty the assistant runs the deterministic offline parser
    # (clearly labelled in the UI). Any OpenAI-compatible endpoint can be configured.
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str | None = None
    llm_model: str = "gpt-4o-mini"
    llm_timeout_seconds: float = 60.0
    ai_daily_message_limit: int = 200
    ai_max_tool_iterations: int = 4

    # --- Rate limiting (per user/IP, in-process) ---
    rate_limit_per_minute: int = 120
    ai_rate_limit_per_minute: int = 20

    # --- Realtime notifications (app/realtime.py) ---
    # Events wait in the queue for at most this long so bursts are delivered in one batch per user.
    # Capped at 5 s: a notification must reach the user within 5 seconds.
    realtime_flush_ms: int = Field(default=1000, ge=50, le=5000)
    realtime_queue_max: int = Field(default=100_000, ge=100)
    realtime_max_streams_per_user: int = Field(default=5, ge=1, le=50)
    # Unset: in-process queue (one API instance). Set: Redis pub/sub so every instance sees every event.
    redis_url: str | None = None

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.environment == "production" and settings.auth_provider == "local" and "insecure" in settings.jwt_secret:
        raise RuntimeError("JWT_SECRET must be set to a strong value in production")
    return settings
