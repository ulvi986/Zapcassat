# ZapCastSat AI

AI-powered B2B marketplace connecting wholesalers/suppliers and craftsmen (ustalar) in Azerbaijan.

- **Suppliers** manage inventory in plain language (“Anbarımda 500 taxta qapı var, hər biri 85 AZN”), in an Excel-like table, or by CSV/XLSX import. Every write the AI proposes is shown as a preview and executed only after explicit confirmation.
- **Craftsmen** describe what they need (“Bakıda 25 ağ MDF qapı lazımdır”) and get ranked, *real* listings. They can compare offers, request quotes, and place orders.
- Azerbaijani UI by default (English/Turkish dictionaries scaffolded), AZN money, light and dark modes, mobile-first buyer experience.

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), TanStack Query + Table, React Hook Form + Zod, Recharts, Lucide |
| Backend | Python, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Data/Auth/Storage | PostgreSQL via Supabase (RLS migration included), Supabase Auth, Supabase Storage. SQLite + local auth + local disk for zero-config development |
| AI | Any OpenAI-compatible `/chat/completions` endpoint with tool calling; deterministic offline parser when no key is configured |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quick start (local, no external accounts)

Prerequisites: **Python 3.11+** with [uv](https://docs.astral.sh/uv/), **Node.js 20+**.

```bash
# 1) Backend  → http://localhost:8000  (API docs at /docs)
cd backend
cp .env.example .env          # defaults: SQLite, local auth, local uploads, offline AI
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 2) Frontend → http://localhost:3000
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

In development the backend creates the SQLite schema automatically on start and seeds the product-category taxonomy (reference data only — **no fake products, suppliers, prices or statistics are ever seeded**). If port 3000 is busy, run `npm run dev -- -p 3100` and add `http://localhost:3100` to `CORS_ORIGINS` in `backend/.env`.

### Try the acceptance workflows

1. Register → choose **“Mən topdansatıcıyam”** → fill in business details.
2. Open **AI köməkçi** and send `Anbarımda 500 taxta qapı, 300 taxta lövhə və 120 laminat panel var. Hər biri 85 AZN`. Review the three preview cards, edit if needed, then **Təsdiqlə** / **Hamısını təsdiqlə**.
3. Open **Inventar**: click any quantity cell, change it, press Enter. The change is written to the ledger (see **Tarixçə**) and can be undone.
4. **Bazar elanları** → publish a product.
5. In another browser profile, register → **“Mən ustayam”** → in **AI axtarış** write `Bakıda 25 taxta qapı lazımdır, sərfəli variantları göstər` → **Təklif istə**.
6. Back as the supplier → **Sorğular və təkliflər** → **Təklif göndər**. The buyer can accept it, which creates an order; confirming the order decrements stock through the ledger.

### AI modes

| Mode | When | Behaviour |
|---|---|---|
| **LLM** | `LLM_API_KEY` set | Streaming OpenAI-compatible model with structured tool calling. Configure `LLM_BASE_URL` / `LLM_MODEL` for any compatible provider. |
| **Offline** (labelled “Oflayn rejim” in the UI) | no key | Deterministic Azerbaijani/English/Turkish command parser that emits the *same* tool calls, so validation → preview → confirmation → execution is identical. It understands inventory entry, price/stock updates, low-stock queries, sales analytics, marketplace search, comparisons and supplier lookup — it is not a general conversational model. |

## Tests

```bash
cd backend
uv run pytest                       # SQLite (RLS test skipped)
TEST_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db uv run pytest   # after `alembic upgrade head`
```

109 tests cover the assistant rule table (every «ƏGƏR → ONDA» example in `app/ai/rules.py` is asserted), guards and follow-ups, inventory calculations and the stock ledger (negative-stock prevention, idempotency, optimistic locking, undo, CSV/XLSX import/export), authorization and tenant isolation (REST and AI tool calls, Postgres RLS), AI tool validation and confirmation, OpenAI stream parsing, marketplace ranking, the quote → quotation → order workflow, and analytics computed from real records.

Frontend checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Project layout

```
backend/
  app/
    core/        settings, security (JWT/argon2), errors, rate limiting
    db/          engine/session, declarative base
    models/      SQLAlchemy schema (22 tables)
    services/    deterministic business logic (products, inventory ledger, marketplace ranking,
                 quotes, orders, analytics, storage, Azerbaijani lexicon)
    ai/          provider interface, OpenAI-compatible + offline providers, tool registry, orchestrator, prompts
    api/         FastAPI routers and dependencies (auth, tenant guard, idempotency keys)
  alembic/       migrations (0001 schema, 0002 Postgres trigram indexes + Supabase RLS)
  tests/
frontend/
  src/app/       routes: landing, auth, onboarding, marketplace, supplier/*, buyer/*
  src/components/ ui (shadcn), app shell, chat (assistant + blocks), marketplace, supplier
  src/lib/       API client (SSE streaming), auth (local/Supabase), formatting, types, hooks
  src/i18n/      az (default) / en / tr dictionaries
docs/            architecture & deployment
render.yaml      backend deployment blueprint
```

## External services you need for production

| Service | Needed for | Where it's configured |
|---|---|---|
| Supabase project | Postgres, Auth, Storage (`product-images` public bucket) | `DATABASE_URL`, `SUPABASE_*` (backend), `NEXT_PUBLIC_SUPABASE_*` (frontend) |
| OpenAI-compatible LLM key | Full natural-language assistant (optional) | `LLM_*` (backend only — never exposed to the browser) |
| Vercel | Frontend hosting | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_PROVIDER=supabase` |
| Python host (Render/Railway/Fly…) | Backend | see `render.yaml`, `backend/Dockerfile` |

Nothing in this repository is connected to those services yet; local development uses the self-contained defaults above.
