"""Postgres-only: trigram search indexes and Row Level Security (defence in depth for Supabase).

The FastAPI backend enforces tenant isolation in its service layer. RLS additionally guarantees that
anyone talking to Supabase directly (PostgREST with the public anon key, or an authenticated user's JWT)
can only read their own tenant's rows, and only *active* marketplace listings publicly.
No write policies are defined: all writes go through the backend.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

MEMBER_TABLES = ["products", "seller_skus", "inventory", "inventory_events", "product_images", "audit_logs"]
OWNER_TABLES = {  # table -> user column
    "profiles": "id",
    "conversations": "user_id",
    "messages": "user_id",
    "ai_actions": "user_id",
    "favorites": "user_id",
    "notifications": "user_id",
}
LOCKED_TABLES = ["local_credentials", "idempotency_keys"]
ALL_TABLES = MEMBER_TABLES + list(OWNER_TABLES) + LOCKED_TABLES + [
    "businesses", "business_members", "product_categories", "marketplace_listings",
    "quote_requests", "quotations", "orders", "order_items",
]


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    # pg_trgm makes the ILIKE '%term%' search index-backed. It ships with Supabase; skip if unavailable.
    op.execute(
        """
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
            CREATE EXTENSION IF NOT EXISTS pg_trgm;
            CREATE INDEX IF NOT EXISTS ix_listings_search_trgm ON marketplace_listings USING gin (search_text gin_trgm_ops);
            CREATE INDEX IF NOT EXISTS ix_products_search_trgm ON products USING gin (search_text gin_trgm_ops);
          ELSE
            RAISE NOTICE 'pg_trgm not available: search falls back to sequential ILIKE scans';
          END IF;
        END $$;
        """
    )

    for t in ALL_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")

    # Policies reference auth.uid(), which exists on Supabase. On plain Postgres RLS stays enabled with
    # no policies (deny-all for non-owner roles), and the backend's owner role is unaffected.
    op.execute(
        """
        DO $$
        BEGIN
          IF to_regprocedure('auth.uid()') IS NULL THEN
            RAISE NOTICE 'auth.uid() not found: skipping Supabase RLS policies';
            RETURN;
          END IF;

          CREATE OR REPLACE FUNCTION public.is_business_member(bid uuid) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
            'SELECT EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = bid AND m.user_id = auth.uid())';

          CREATE POLICY categories_read ON product_categories FOR SELECT TO anon, authenticated USING (true);

          CREATE POLICY listings_public_read ON marketplace_listings FOR SELECT TO anon, authenticated
            USING (status = 'active' OR public.is_business_member(business_id));

          CREATE POLICY businesses_member_read ON businesses FOR SELECT TO authenticated
            USING (public.is_business_member(id));
          CREATE POLICY members_self_read ON business_members FOR SELECT TO authenticated
            USING (user_id = auth.uid());

          CREATE POLICY quote_requests_read ON quote_requests FOR SELECT TO authenticated
            USING (buyer_id = auth.uid() OR public.is_business_member(supplier_business_id));
          CREATE POLICY quotations_read ON quotations FOR SELECT TO authenticated
            USING (public.is_business_member(supplier_business_id) OR EXISTS (
              SELECT 1 FROM quote_requests q WHERE q.id = quote_request_id AND q.buyer_id = auth.uid()));
          CREATE POLICY orders_read ON orders FOR SELECT TO authenticated
            USING (buyer_id = auth.uid() OR public.is_business_member(supplier_business_id));
          CREATE POLICY order_items_read ON order_items FOR SELECT TO authenticated
            USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id
                           AND (o.buyer_id = auth.uid() OR public.is_business_member(o.supplier_business_id))));
        END $$;
        """
    )
    for t in MEMBER_TABLES:
        op.execute(
            f"""
            DO $$ BEGIN
              IF to_regprocedure('auth.uid()') IS NOT NULL THEN
                CREATE POLICY {t}_member_read ON {t} FOR SELECT TO authenticated USING (public.is_business_member(business_id));
              END IF;
            END $$;
            """
        )
    for t, col in OWNER_TABLES.items():
        op.execute(
            f"""
            DO $$ BEGIN
              IF to_regprocedure('auth.uid()') IS NOT NULL THEN
                CREATE POLICY {t}_owner_read ON {t} FOR SELECT TO authenticated USING ({col} = auth.uid());
              END IF;
            END $$;
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        DO $$ DECLARE r record; BEGIN
          FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
          END LOOP;
        END $$;
    """)
    for t in ALL_TABLES:
        op.execute(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS public.is_business_member(uuid)")
    op.execute("DROP INDEX IF EXISTS ix_listings_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_products_search_trgm")
