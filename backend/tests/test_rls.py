"""Row Level Security checks. Runs only against Postgres with Supabase's auth.uid()
(TEST_DATABASE_URL=postgresql+psycopg://... after `alembic upgrade head`)."""

import os

import pytest
import sqlalchemy as sa

from tests.conftest import create_product, publish

pytestmark = pytest.mark.skipif(not (os.environ.get("TEST_DATABASE_URL") or "").startswith("postgresql"),
                                reason="RLS requires Postgres")


def _as(conn, role: str, user_id: str | None):
    conn.execute(sa.text(f"SET LOCAL ROLE {role}"))
    conn.execute(sa.text("SELECT set_config('request.jwt.claim.sub', :sub, true)"), {"sub": user_id or ""})


def test_rls_isolates_tenants(make_supplier):
    from app.db.session import engine

    a = make_supplier("A Biznes")
    b = make_supplier("B Biznes")
    pa = create_product(a, name="A qapı")
    create_product(b, name="B qapı")
    publish(a, pa["id"])
    with engine.connect() as conn:
        for t in ("products", "inventory", "inventory_events", "marketplace_listings", "businesses"):
            conn.execute(sa.text(f"GRANT SELECT ON {t} TO anon, authenticated"))
        conn.commit()
        with conn.begin():
            _as(conn, "authenticated", b.me["id"])
            names = conn.execute(sa.text("SELECT name FROM products")).scalars().all()
            assert names == ["B qapı"]
            assert conn.execute(sa.text("SELECT count(*) FROM inventory")).scalar() == 1
            # B sees A's *public* listing but not A's business row
            assert conn.execute(sa.text("SELECT count(*) FROM marketplace_listings")).scalar() == 1
            assert conn.execute(sa.text("SELECT count(*) FROM businesses")).scalar() == 1
        with conn.begin():
            _as(conn, "anon", None)
            assert conn.execute(sa.text("SELECT count(*) FROM products")).scalar() == 0
            assert conn.execute(sa.text("SELECT count(*) FROM marketplace_listings")).scalar() == 1
