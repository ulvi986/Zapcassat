"""Realtime notifications: message queue → dispatcher → per-user SSE streams.

1. Service code calls notify_user(); the Notification row is written in the caller's transaction and the
   recipient is remembered on the session.
2. After COMMIT the events are put on the queue (rolled-back work publishes nothing). With REDIS_URL set they
   go through a Redis channel instead, so every API instance receives every event.
3. The dispatcher wakes on the first queued event, waits REALTIME_FLUSH_MS (≤ 5 s) so a burst becomes one
   batch, coalesces the batch per user and pushes one message to each of that user's open streams.
4. The browser re-fetches what changed. The database row is the source of truth: if a realtime message is
   dropped (queue full, stream closed) the client's fallback polling still shows it — late, never lost.

Publishing never blocks a request: it is a non-blocking put on a bounded queue.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.errors import AppError

log = logging.getLogger("zapcastsat.realtime")

CHANNEL = "zapcastsat:notify"
STREAM_BUFFER = 20  # coalesced messages buffered per open stream before it is told to resync


class TooManyStreams(AppError):
    status_code = 429
    code = "too_many_streams"


@dataclass
class Stats:
    published: int = 0
    delivered: int = 0
    dropped: int = 0
    batches: int = 0
    last_batch_ms: float = 0.0
    max_wait_ms: float = 0.0


@dataclass
class Hub:
    flush_ms: int = 1000
    queue_max: int = 100_000
    max_streams_per_user: int = 5
    redis_url: str | None = None
    stats: Stats = field(default_factory=Stats)

    def __post_init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[tuple[str, str, float]] | None = None
        self._streams: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._tasks: list[asyncio.Task] = []
        self._redis = None

    @property
    def broker(self) -> str:
        return "redis" if self.redis_url else "local"

    @property
    def connections(self) -> int:
        return sum(len(s) for s in self._streams.values())

    def status(self) -> dict:
        return {"broker": self.broker, "running": self.loop is not None, "flush_ms": self.flush_ms,
                "connections": self.connections, "queued": self._queue.qsize() if self._queue else 0,
                "published": self.stats.published, "delivered": self.stats.delivered, "dropped": self.stats.dropped,
                "max_wait_ms": round(self.stats.max_wait_ms)}

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=self.queue_max)
        self._tasks = [asyncio.create_task(self._dispatch(), name="realtime-dispatch")]
        if self.redis_url:
            import redis.asyncio as redis

            self._redis = redis.from_url(self.redis_url)
            pubsub = self._redis.pubsub()
            await pubsub.subscribe(CHANNEL)  # subscribed before we report ready
            self._tasks.append(asyncio.create_task(self._listen(pubsub), name="realtime-redis"))
        log.info("realtime ready (broker=%s, flush=%sms)", self.broker, self.flush_ms)

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        if self._redis is not None:
            await self._redis.aclose()
        self.loop, self._queue, self._tasks, self._redis = None, None, [], None

    # ------------------------------------------------------------------ publish (any thread)
    def publish(self, events: list[tuple[str, str]]) -> None:
        """Queue (user_id, kind) events. Thread-safe and non-blocking; a no-op when not running."""
        loop = self.loop
        if loop is None or not events:
            return
        now = time.monotonic()
        stamped = [(u, k, now) for u, k in events]
        if self._redis is not None:
            loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self._publish_redis(stamped)))
        else:
            loop.call_soon_threadsafe(self._enqueue, stamped)

    def _enqueue(self, events: list[tuple[str, str, float]]) -> None:
        for e in events:
            try:
                self._queue.put_nowait(e)
                self.stats.published += 1
            except asyncio.QueueFull:
                self.stats.dropped += 1  # still in the DB; the client's fallback polling picks it up

    async def _publish_redis(self, events: list[tuple[str, str, float]]) -> None:
        try:
            await self._redis.publish(CHANNEL, json.dumps([[u, k] for u, k, _ in events]))
        except Exception:  # Redis down: degrade to this instance only rather than losing the event
            log.exception("redis publish failed; delivering locally")
            self._enqueue(events)

    async def _listen(self, pubsub) -> None:
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            try:
                now = time.monotonic()
                self._enqueue([(u, k, now) for u, k in json.loads(msg["data"])])
            except (ValueError, TypeError):
                log.warning("ignored malformed realtime message")

    # ------------------------------------------------------------------ dispatcher
    async def _dispatch(self) -> None:
        q = self._queue
        while True:
            first = await q.get()
            await asyncio.sleep(self.flush_ms / 1000)  # let the burst collect
            batch = [first]
            while not q.empty():
                batch.append(q.get_nowait())
            self.deliver(batch)

    def deliver(self, batch: list[tuple[str, str, float]]) -> None:
        by_user: dict[str, set[str]] = defaultdict(set)
        oldest: dict[str, float] = {}
        for user_id, kind, ts in batch:
            by_user[user_id].add(kind)
            oldest[user_id] = min(ts, oldest.get(user_id, ts))
        now = time.monotonic()
        for user_id, kinds in by_user.items():
            msg = {"kinds": sorted(kinds)}
            for stream in self._streams.get(user_id, ()):
                if stream.full():  # a stalled client: replace its backlog with one "refetch everything"
                    while not stream.empty():
                        stream.get_nowait()
                    msg = {"kinds": ["*"]}
                stream.put_nowait(msg)
                self.stats.delivered += 1
            self.stats.max_wait_ms = max(self.stats.max_wait_ms, (now - oldest[user_id]) * 1000)
        self.stats.batches += 1
        self.stats.last_batch_ms = (time.monotonic() - now) * 1000

    # ------------------------------------------------------------------ subscribers (event loop only)
    def open_stream(self, user_id: str) -> asyncio.Queue:
        streams = self._streams[user_id]
        if len(streams) >= self.max_streams_per_user:
            raise TooManyStreams("Çox sayda açıq bağlantı. Bəzi tabları bağlayın.")
        stream: asyncio.Queue = asyncio.Queue(maxsize=STREAM_BUFFER)
        streams.add(stream)
        return stream

    def close_stream(self, user_id: str, stream: asyncio.Queue) -> None:
        streams = self._streams.get(user_id)
        if streams is not None:
            streams.discard(stream)
            if not streams:
                del self._streams[user_id]


hub = Hub()


def configure(settings) -> Hub:
    hub.flush_ms = settings.realtime_flush_ms
    hub.queue_max = settings.realtime_queue_max
    hub.max_streams_per_user = settings.realtime_max_streams_per_user
    hub.redis_url = settings.redis_url
    return hub


# ---------------------------------------------------------------------- transaction hooks
def remember(db: Session, user_id, kind: str) -> None:
    """Publish (user_id, kind) once the current transaction commits."""
    db.info.setdefault("realtime", []).append((str(user_id), kind))


@event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    events = session.info.pop("realtime", None)
    if events:
        hub.publish(events)


@event.listens_for(Session, "after_rollback")
def _discard_after_rollback(session: Session) -> None:
    session.info.pop("realtime", None)
