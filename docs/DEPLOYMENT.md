# Deployment

Target topology: **Vercel** (frontend) → **Python host** (backend, Docker) → **Supabase** (Postgres, Auth, Storage).

## 1. Supabase

1. Create a project.
2. **Database URL** — Project Settings → Database → connection string (use the session pooler on port 5432). Prefix it for SQLAlchemy/psycopg:
   `postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. **Run migrations** from your machine (or let the Docker image do it on start):
   ```bash
   cd backend
   DATABASE_URL="postgresql+psycopg://..." uv run alembic upgrade head
   ```
   Migration `0002` enables `pg_trgm` search indexes and Row Level Security policies (it detects `auth.uid()`).
4. **Auth** — enable Email provider. Note the project URL and the anon key (public) for the frontend. The backend verifies tokens via `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`; if your project still uses the legacy HS256 secret, set `SUPABASE_JWT_SECRET` instead.
5. **Storage** — create a **public** bucket named `product-images` (or set `SUPABASE_STORAGE_BUCKET`). Uploads are performed by the backend with the service-role key after validating the file.

## 2. Backend (Render, Railway, Fly.io, any Docker host)

The image (`backend/Dockerfile`) runs `alembic upgrade head` and then uvicorn on `$PORT`.

Render: “New → Blueprint” and select this repo; `render.yaml` defines the service. Fill the `sync: false` variables:

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` (disables `/docs`, enforces a strong `JWT_SECRET` in local-auth mode) |
| `DATABASE_URL` | Supabase connection string (above) |
| `CORS_ORIGINS` | your Vercel URL(s), comma-separated |
| `AUTH_PROVIDER` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key (server only!) |
| `STORAGE_PROVIDER` | `supabase` |
| `PUBLIC_BASE_URL` | the backend's public URL |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional; without a key the assistant runs in offline mode |
| `SENTRY_DSN` | optional (requires adding `sentry-sdk` to dependencies) |

Health check: `GET /health`.

Scaling notes: rate limiting is in-process — use a single instance or move `core/rate_limit.py` to Redis before scaling horizontally. The SSE endpoint needs proxy buffering disabled (the response sets `X-Accel-Buffering: no`).

## 3. Frontend (Vercel)

1. Import the repo, set **Root Directory** to `frontend`.
2. Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | backend URL, no trailing slash |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon (public) key |

3. Deploy. Add the Vercel domain to the backend's `CORS_ORIGINS` and to Supabase Auth → URL configuration (site URL / redirect URLs).

## 4. Post-deploy checklist

- [ ] Register a supplier, add stock via the assistant, confirm, see it in **Inventar**.
- [ ] Register a craftsman, search in Azerbaijani, send a quote request.
- [ ] Respond as the supplier; accept as the buyer; confirm the order and verify stock decreased.
- [ ] Verify with the anon key that `select * from products` through PostgREST returns no rows.
- [ ] Rotate any keys that were ever shared outside the secret store.
