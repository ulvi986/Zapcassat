# ZapCastSat AI — Architecture

## Overview

```
 Browser (Next.js, React)                 FastAPI backend                         PostgreSQL (Supabase)
 ─────────────────────────                ───────────────                         ─────────────────────
 Supplier workspace  ──┐  REST + SSE      api/ routers ─► deps (auth, tenant      22 tables, NUMERIC money,
 Buyer workspace     ──┼────────────────► guard, idempotency) ─► services/ ──────► CHECK(quantity >= 0),
 Public marketplace  ──┘  Bearer JWT      ai/ orchestrator ─► tool registry ─┘     RLS policies (defence in depth)
                                            │
                                            └─► LLM provider (OpenAI-compatible | offline parser)
```

Principles:

1. **Business logic is deterministic and lives in `services/`.** Routes, AI tools and imports all call the same functions. The LLM never computes prices or stock and never touches SQL.
2. **Tenant isolation is enforced in one place.** Every supplier route is mounted under `/businesses/{business_id}` and depends on `require_member()`; every query in the services filters by `business_id`. Non-members get `404` (existence is not leaked). AI tool contexts take the tenant from the session, never from model arguments.
3. **Private vs public data.** `products`, `inventory`, `inventory_events`, purchase prices and audit logs are private. Buyers only ever see `marketplace_listings` + public supplier fields + available quantity when the supplier enabled `show_stock`.
4. **No silent overwrites.** Every stock change is an `inventory_events` row written under a row lock in the same transaction as the quantity update.

## Data model

| Area | Tables |
|---|---|
| Identity & tenancy | `profiles` (id = Supabase `auth.users.id`), `local_credentials` (dev auth only), `businesses`, `business_members` (role: owner/admin/staff; a user may belong to many businesses) |
| Catalogue & stock | `product_categories` (az/en/tr names), `products`, `seller_skus` (aliases/barcodes), `inventory` (per product × warehouse, `version` for optimistic locking, `CHECK quantity >= 0`), `inventory_events` (append-only ledger), `product_images` |
| Marketplace | `marketplace_listings` (public price, MOQ, visibility, normalised `search_text`), `favorites` |
| AI | `conversations`, `messages` (text + structured UI blocks), `ai_actions` (pending → executed/rejected/failed) |
| Commerce | `quote_requests` (one per supplier, grouped by `group_id`), `quotations`, `orders`, `order_items` |
| Cross-cutting | `notifications`, `audit_logs`, `idempotency_keys` |

Money is `NUMERIC(14,2)`, quantities `NUMERIC(14,3)` (m², kg, …). Values cross the API as decimal strings and are only converted to numbers for display.

Inventory value = quantity × purchase price; when no purchase price is recorded the selling price is used (stated in the UI).

## Inventory ledger

`services/inventory.adjust_stock()`:

1. Optional idempotency key → returns the earlier event on replay.
2. `SELECT … FOR UPDATE` on the inventory row; optional `expected_version` check (409 `stale_version`).
3. Computes the new quantity; rejects negatives (`422 insufficient_stock`) — the DB `CHECK` is the last line of defence.
4. Writes the event + audit log, bumps `version`.

Undo creates a compensating `undo` event and is only allowed for the latest event of a product (sales are reverted by cancelling the order instead). CSV/XLSX import upserts by SKU/name and records quantity changes as `import` events; it supports a dry run with per-row results.

Orders: creation checks MOQ and availability; **supplier confirmation** decrements stock (`sale` events) in the same transaction; cancelling a confirmed order restocks (`order_cancel`). Revenue analytics only count `confirmed`/`fulfilled` orders.

## AI assistant

```
user message ─► orchestrator.run_turn()
                 ├─ rate limit + daily quota, membership re-check
                 ├─ provider.stream(system prompt + history, role-specific tool schemas)
                 │     text deltas ─────────────────────────────► SSE "token"
                 │     tool calls ─► registry.validate (Pydantic, extra="forbid")
                 │                    ├─ read tool  ─► service ─► result to model + UI block ─► SSE "block"
                 │                    └─ write tool ─► preview (matches, warnings, missing fields)
                 │                                     + AIAction(status=pending) ─► SSE "block"
                 └─ persist assistant message (text + blocks) ─► SSE "done"

user clicks Təsdiqlə ─► POST /ai/actions/{id}/confirm {overrides}
                 ├─ ownership + tenant re-check, merge overrides, re-validate
                 ├─ atomic claim: UPDATE … SET status='executed' WHERE status='pending'
                 └─ deterministic service call in one transaction (rolls back + stays pending on user-fixable errors)
```

Tools: `create_product`, `update_product`, `update_inventory`, `update_price`, `search_inventory`, `get_inventory_summary`, `get_sales_analytics` (supplier); `search_marketplace`, `compare_offers`, `find_suppliers`, `create_quote_request` (buyer). Tool availability is per conversation mode; calling a tool of the other role fails validation.

Prompt-injection posture: tool results are passed back as JSON data and the system prompt marks them untrusted; but safety does not depend on the prompt — tenant scoping, schema validation and human confirmation are enforced in code.

Providers implement one method, `stream(messages, tools) -> Iterator[ProviderEvent]`:

- `OpenAICompatibleProvider` — httpx streaming, assembles fragmented tool-call deltas (unit-tested with a mock transport).
- `RuleBasedProvider` — offline mode; executes the rule table below.

### Rules, guards and assertions (both modes)

```
ai/nlu.py     message → features: money vs quantity vs time window, units, city, ordinal («birincisinə»),
              product reference with case suffixes removed («Taxta qapının» → «Taxta qapı»), [context: …] of earlier turns
ai/rules.py   RULES: «ƏGƏR <when> → ONDA <then>» with priority, match(), act() and examples
ai/guards.py  GUARDS: checks on every tool call (block / fix / warn) + ungrounded_amounts() for the answer text
ai/prompts.py renders the same rules, examples and guards into the LLM system prompt
```

- **Offline mode** runs the highest-priority rule whose `match` holds and whose `act` returns a plan (tool calls or a
  reply/clarifying question). Messages with several edits («qiymətini 90 et və stokunu 20 azalt») are planned clause by
  clause; a clause without a product refers to the previous one.
- **LLM mode** gets the same `when`/`then` sentences and up to two examples per rule in its system prompt.
- **Guards** run after Pydantic validation in both modes: quote requests only for listings this conversation showed
  (block), meaningless product names (block), exact-duplicate names are merged into the existing product (fix, explained
  on the card), large price jumps / huge quantities / 0 ₼ / quantity below MOQ (warn on the card).
- **Answer assertion**: money amounts in the assistant's text must appear in tool results or the conversation; otherwise
  a warning notice is shown under the answer.
- **Tests**: `tests/test_rules.py` turns every rule example into a test that checks *which* rule fired and the exact tool
  calls, plus end-to-end tests for guards and follow-ups. To add a behaviour, add a `Rule` with an example — it is
  tested and shown to the LLM automatically.

The lexicon (`services/lexicon.py`) provides dotted/dotless-i aware lowercasing, diacritic folding, suffix stemming
(including stacked suffixes such as *laminatından → laminat*), concept synonyms az/en/tr/ru, units and cities.

## Realtime notifications (message queue)

```
service code ─ notify_user() ─► Notification row (same transaction)
                                   │ after COMMIT (rollback publishes nothing)
                                   ▼
                     bounded queue (REALTIME_QUEUE_MAX)  ── or Redis pub/sub when REDIS_URL is set
                                   │ dispatcher wakes on the first event, waits REALTIME_FLUSH_MS (≤ 5 s),
                                   │ coalesces the batch per user
                                   ▼
          GET /api/v1/notifications/stream (SSE, per user, ≤ 5 streams)  ─►  browser re-fetches what changed
```

- `app/realtime.py` — `Hub` (queue, dispatcher, per-user streams), after-commit hook, optional Redis fan-out.
- Delivery target: ≤ 5 s. Measured: one quote request → supplier's screen in 1.1 s (1.0 s of it is the batching
  window); 10 000 connected users × 3 events published from 8 threads all delivered in 1.3 s (`tests/test_realtime.py`).
- Publishing never blocks a request. If the queue is full the event is counted as dropped, but the notification is
  already in the database; the client's fallback polling (30 s, only while the stream is disconnected) shows it.
- A stream is `async` and holds no DB connection; heartbeats every 15 s; clients reconnect with exponential backoff
  and jitter so thousands of clients do not reconnect in the same second.
- `/health` reports the queue: broker, connections, queued, published, delivered, dropped, max wait.
- One API instance: the in-process queue is enough. Several instances: set `REDIS_URL` (tested with fakeredis).

## Marketplace search & ranking

`search_text` columns store folded stems plus concept tags (`#door #white #mdf`). Postgres uses `pg_trgm` GIN indexes for the `ILIKE` filters (migration 0002). Requirement parsing extracts product types, attributes (colour/material), quantity + unit, city, price ceiling and a “cheap” preference. Ranking:

- product type must match (white paint never matches “white door”); attribute coverage and keyword hits add relevance,
- stock sufficiency for the requested quantity (when the supplier shows stock), MOQ penalty,
- relative price (weighted higher when the buyer asks for cheap/sərfəli), same-city bonus.

Each result carries machine-readable reasons (`stock_sufficient`, `same_city`, `cheapest`, …) rendered as badges. When nothing matches, the API says so and offers same-type alternatives — results are never fabricated. Semantic search with pgvector is intentionally deferred (Phase 3).

## Authentication

- **Local** (`AUTH_PROVIDER=local`): argon2-hashed passwords, HS256 JWTs issued by the backend. For development/self-hosting.
- **Supabase** (`AUTH_PROVIDER=supabase`): the frontend uses supabase-js; the backend verifies access tokens via the project JWKS (or the legacy HS256 secret) and lazily mirrors the user into `profiles`.

Roles are derived from data (member of a supplier business ⇒ supplier; completed craftsman profile ⇒ buyer), so one account can hold both and more roles can be added later. Frontend route guards are UX only; the API enforces everything.

## Row Level Security

Migration `0002` enables RLS on all tables. On Supabase it adds read policies based on `auth.uid()` (members read their business data; anyone reads active listings; users read their own conversations/notifications/quotes/orders). No write policies exist — all writes go through the backend. The backend connects with a privileged role and enforces authorization itself; RLS protects against direct PostgREST access with the public anon key. Verified by `tests/test_rls.py` on Postgres.

## Reliability & security checklist

- Consistent error envelope `{"error": {code, message, details}}`; request IDs (`X-Request-ID`) and structured access logs; optional Sentry hook (`SENTRY_DSN`).
- Idempotency keys on create/adjust/quote/order/accept endpoints (`Idempotency-Key` header) and atomic state transitions (AI actions, quotations, orders).
- In-process sliding-window rate limits (IP and per-user AI/quote limits) + persistent daily AI quota. Swap to Redis for multi-instance deployments.
- Uploads: size limit, magic-byte sniffing (JPEG/PNG/WEBP only), random server-side names, business-scoped paths.
- Secrets only in environment variables; the browser only receives `NEXT_PUBLIC_*` values (API URL, Supabase anon key).

## Frontend

- App Router with Cache Components; workspaces are client-rendered behind `RequireRole`, data via TanStack Query, the assistant via a `fetch` + `ReadableStream` SSE reader.
- Design tokens in `globals.css` (navy `#101D2B`, lime `#D4FF75`, blue `#2563EB`, cloud `#F6F8FA`…), separately tuned dark theme, Inter font, 12–16 px radii.
- Charts are single-series and use one validated hue per theme (`--chart-1`), no legends, hairline grids, tooltips, and screen-reader tables.
- Every data view has loading (skeleton), empty, error (with retry) and success (toast) states.

## Roadmap (not implemented yet)

- **Phase 2:** buyer↔supplier messaging threads, multi-item cart and checkout, delivery management, multiple warehouses UI (schema already supports `warehouse_code`), supplier verification workflow, richer import mapping.
- **Phase 3:** pgvector semantic matching, demand forecasting, reorder recommendations, personalised supplier recommendations, BI dashboards.
- Complete English/Turkish dictionaries and route all page copy through `t()` (navigation and shared labels already are).
