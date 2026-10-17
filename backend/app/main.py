from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError

from app.api.routes import ai, auth, marketplace, notifications, supplier
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.session import SessionLocal, engine
from app.models import Base
from app.realtime import configure as configure_realtime
from app.services.categories import seed_categories

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("zapcastsat")


def _init_monitoring() -> None:
    """Monitoring hook: enable Sentry when SENTRY_DSN is set and sentry-sdk is installed."""
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return
    try:
        import sentry_sdk  # type: ignore

        sentry_sdk.init(dsn=dsn, traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")))
        log.info("Sentry monitoring enabled")
    except ImportError:
        log.warning("SENTRY_DSN set but sentry-sdk is not installed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    _init_monitoring()
    if settings.is_sqlite:
        # Zero-config local development: create tables directly. Postgres uses Alembic migrations.
        Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_categories(db)
    log.info("ZapCastSat API ready (auth=%s, llm=%s, storage=%s)", settings.auth_provider,
             "configured" if settings.llm_enabled else "offline-parser", settings.storage_provider)
    hub = configure_realtime(settings)
    await hub.start()
    try:
        yield
    finally:
        await hub.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="ZapCastSat AI API", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if settings.environment != "production" else None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "Content-Disposition"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path, response.status_code,
                 (time.perf_counter() - start) * 1000, rid)
        return response

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code,
                            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"error": {
            "code": "validation_failed", "message": "Daxil edilən məlumat yanlışdır", "details": details}})

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError):
        log.warning("integrity error: %s", exc.orig)
        return JSONResponse(status_code=409, content={"error": {
            "code": "conflict", "message": "Əməliyyat məlumat bütövlüyü qaydalarını pozur", "details": None}})

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse(status_code=500, content={"error": {
            "code": "internal_error", "message": "Gözlənilməz xəta baş verdi", "details": None}})

    prefix = settings.api_prefix
    for r in (auth.router, supplier.router, marketplace.public, marketplace.buyer, ai.router, notifications.router):
        app.include_router(r, prefix=prefix)

    @app.get("/health")
    def health():
        from app.realtime import hub

        return {"status": "ok", "realtime": hub.status()}

    if settings.storage_provider == "local":
        upload_dir = Path(settings.local_upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")
    return app


app = create_app()
