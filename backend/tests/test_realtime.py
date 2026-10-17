"""Realtime queue: notifications reach the user's stream within 5 seconds, bursts are coalesced,
rolled-back work publishes nothing, and Redis fans events out across API instances."""

import asyncio
import threading
import time

import pytest

from app.realtime import Hub, TooManyStreams, hub
from tests.conftest import create_product, publish

DEADLINE = 5.0


def _run(coro):
    return asyncio.run(coro)


async def _next(stream, timeout=DEADLINE):
    return await asyncio.wait_for(stream.get(), timeout)


def test_burst_is_coalesced_and_delivered_within_deadline():
    async def main():
        h = Hub(flush_ms=300)
        await h.start()
        try:
            s = h.open_stream("u1")
            t0 = time.monotonic()
            # published from request threads, like the after-commit hook does
            threads = [threading.Thread(target=h.publish, args=([("u1", k)],)) for k in ("quote.new", "order.new", "quote.new")]
            for t in threads:
                t.start()
            msg = await _next(s)
            assert time.monotonic() - t0 < DEADLINE
            assert msg == {"kinds": ["order.new", "quote.new"]}
            assert s.empty()  # one message for the whole burst
        finally:
            await h.stop()

    _run(main())


def test_ten_thousand_users_at_once():
    """10 000 connected users, 3 notifications each, published from 8 threads at the same moment."""
    async def main():
        h = Hub(flush_ms=1000, queue_max=100_000)
        await h.start()
        try:
            users = [f"user-{i}" for i in range(10_000)]
            streams = {u: h.open_stream(u) for u in users}
            t0 = time.monotonic()

            def send(chunk):
                for u in chunk:
                    h.publish([(u, "quote.new"), (u, "quote.quoted"), (u, "order.new")])

            threads = [threading.Thread(target=send, args=(users[i::8],)) for i in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for u in users:
                assert (await _next(streams[u]))["kinds"] == ["order.new", "quote.new", "quote.quoted"]
            elapsed = time.monotonic() - t0
            assert elapsed < DEADLINE, elapsed
            assert h.stats.dropped == 0 and h.stats.max_wait_ms < DEADLINE * 1000
        finally:
            await h.stop()

    _run(main())


def test_full_queue_drops_instead_of_blocking_and_stalled_client_resyncs():
    async def main():
        h = Hub(flush_ms=50, queue_max=2)
        await h.start()
        try:
            s = h.open_stream("u1")
            h.publish([("u1", "a"), ("u1", "b"), ("u1", "c")])  # 3rd does not fit: dropped, request not blocked
            await asyncio.sleep(0)
            assert h.stats.dropped == 1
            assert (await _next(s))["kinds"] == ["a", "b"]
            for i in range(30):  # client never reads: backlog is replaced by one "refetch everything"
                h.deliver([("u1", f"k{i}", time.monotonic())])
            assert s.qsize() < 30 and {"kinds": ["*"]} in [s.get_nowait() for _ in range(s.qsize())]
        finally:
            await h.stop()

    _run(main())


def test_stream_limit_per_user():
    h = Hub(max_streams_per_user=2)
    h.open_stream("u1")
    h.open_stream("u1")
    with pytest.raises(TooManyStreams):
        h.open_stream("u1")


def test_redis_fans_out_across_instances(monkeypatch):
    fakeredis = pytest.importorskip("fakeredis")
    import redis.asyncio

    server = fakeredis.FakeServer()
    monkeypatch.setattr(redis.asyncio, "from_url", lambda url: fakeredis.FakeAsyncRedis(server=server))

    async def main():
        a, b = Hub(flush_ms=100, redis_url="redis://x"), Hub(flush_ms=100, redis_url="redis://x")
        await a.start()
        await b.start()
        try:
            s = b.open_stream("u1")  # user connected to instance B
            a.publish([("u1", "quote.new")])  # request handled by instance A
            assert (await _next(s))["kinds"] == ["quote.new"]
        finally:
            await a.stop()
            await b.stop()

    _run(main())


# ---------------------------------------------------------------------------
# Integration: the after-commit hook
# ---------------------------------------------------------------------------
@pytest.fixture
def published(monkeypatch):
    seen = []
    monkeypatch.setattr(hub, "publish", lambda events: seen.extend(events))
    return seen


def test_quote_request_notifies_supplier_after_commit(make_supplier, make_buyer, published):
    s = make_supplier()
    listing = publish(s, create_product(s)["id"])
    u = make_buyer()
    r = u.post("/quote-requests", json={"listing_ids": [listing["id"]], "quantity": "10"})
    assert r.status_code == 201, r.text
    assert (s.me["id"], "quote.new") in published


def test_rolled_back_work_publishes_nothing(make_supplier, published):
    from app.db.session import SessionLocal
    from app.services.common import notify_user

    s = make_supplier()
    with SessionLocal() as db:
        notify_user(db, s.me["id"], type="quote.new", title="x")
        db.rollback()
    assert published == []


def test_stream_requires_login(client):
    assert client.get("/api/v1/notifications/stream").status_code == 401


def test_health_reports_queue(client):
    rt = client.get("/health").json()["realtime"]
    assert rt["broker"] == "local" and rt["running"] and rt["flush_ms"] <= 5000
