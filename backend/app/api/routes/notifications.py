from __future__ import annotations

import asyncio
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from starlette.concurrency import run_in_threadpool

from app.api.deps import DB, CurrentUser, current_user
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Notification
from app.realtime import hub
from app.services.common import iso, utc_now

HEARTBEAT_SECONDS = 15

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(db: DB, user: CurrentUser, unread_only: bool = False):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = db.scalars(stmt.order_by(Notification.created_at.desc()).limit(100)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    return {"unread": unread, "items": [
        {"id": str(n.id), "type": n.type, "title": n.title, "body": n.body, "link": n.link,
         "read": n.read_at is not None, "created_at": iso(n.created_at)} for n in rows]}


def _authenticate(authorization: str | None) -> str:
    # Own short-lived session: a stream stays open for hours and must not hold a DB connection.
    with SessionLocal() as db:
        return str(current_user(db, get_settings(), authorization).id)


@router.get("/stream")
async def stream(request: Request, authorization: Annotated[str | None, Header()] = None):
    """Server-Sent Events: `notify` with {"kinds": [...]} whenever this user gets a notification (≤ 5 s),
    a comment line every 15 s to keep proxies from closing the connection."""
    user_id = await run_in_threadpool(_authenticate, authorization)
    queue = hub.open_stream(user_id)

    async def events():
        try:
            yield f"retry: 3000\nevent: ready\ndata: {json.dumps({'flush_ms': hub.flush_ms})}\n\n"
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: notify\ndata: {json.dumps(msg)}\n\n"
        finally:
            hub.close_stream(user_id, queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/{notification_id}/read")
def mark_read(notification_id: uuid.UUID, db: DB, user: CurrentUser):
    db.execute(update(Notification).where(Notification.id == notification_id, Notification.user_id == user.id,
                                          Notification.read_at.is_(None)).values(read_at=utc_now()))
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(db: DB, user: CurrentUser):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
               .values(read_at=utc_now()))
    db.commit()
    return {"ok": True}
