# Production deploy on Railway

This guide walks through a first-time deploy of amass-crm-v2 to
[Railway](https://railway.com). Railway is the chosen SaaS target;
the Docker Compose stack in `infra/` remains canonical for local dev
and on-prem.

Three deployable services + three managed dependencies:

| Service     | Type       | Source                  | Health probe         |
|-------------|------------|-------------------------|----------------------|
| `api`       | Dockerfile | `apps/api/Dockerfile`   | `/api/v1/health`     |
| `web`       | Dockerfile | `apps/web/Dockerfile`   | `/`                  |
| `ai-worker` | Dockerfile | `apps/ai-worker/Dockerfile` | `/health`        |
| Postgres    | addon      | Railway managed         | n/a                  |
| Redis       | addon      | Railway managed         | n/a                  |
| Object storage | external | Cloudflare R2 / Backblaze B2 | n/a            |

Railway has no managed S3-compatible store, so MinIO is replaced by an
external provider (see [Object storage](#object-storage) below).

---

## Prerequisites

1. **Railway account** at <https://railway.com>. The free tier (5 USD trial
   credit) is **not enough** to keep this stack up — see [Cost expectations](#cost-expectations).
2. **Railway CLI**:
   ```bash
   # macOS
   brew install railway
   # Linux / WSL
   curl -fsSL https://railway.com/install.sh | sh
   # via npm
   npm i -g @railway/cli
   ```
   Verify: `railway --version` should print `railway 3.x` or newer.
3. **Cloudflare or Backblaze account** for object storage (see below).
4. **Docker** locally (only needed if you want to test a build before pushing).
5. **A clean `main` branch**: `pnpm lint && pnpm test` pass; CI green.

Pre-flight validation:

```bash
scripts/check-railway-readiness.sh
```

This lists every env var Railway needs per service and checks that the
Dockerfiles exist. It exits non-zero with a checklist if anything is
missing — fix it before continuing.

---

## Step 1 — Log in and create the project

```bash
railway login           # opens a browser
railway init            # one-time, in the repo root
```

`railway init` creates an empty project and prints the project ID. From the
Railway dashboard, open the project — you'll add 3 services + 2 addons next.

---

## Step 2 — Provision managed Postgres and Redis

Both are 1-click addons. From the project dashboard:

1. Click **New** → **Database** → **Add PostgreSQL**.
   Railway provisions Postgres 16 and exposes `DATABASE_URL` automatically.
   - You can also reference `DATABASE_PUBLIC_URL` if you need to run
     migrations from your laptop (`prisma migrate deploy`).
2. Click **New** → **Database** → **Add Redis**.
   Exposes `REDIS_URL`. Both api and ai-worker reference this.

Notes:
- Railway's Postgres includes nightly snapshots out of the box.
- pgvector is **not** installed by default. You need to enable it
  manually after the first deploy:
  ```bash
  railway connect postgres   # opens psql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
  This is required by the AI embeddings table (S14). Without it, the
  migration that creates `vector` columns will fail.

### Object storage

Railway has no managed S3 store. Two options, in order of recommendation:

1. **Cloudflare R2** (recommended).
   - **Why**: zero egress fees (huge for a CRM that serves attachments),
     S3-compatible API, ~$0.015/GB-month storage.
   - Sign up at <https://dash.cloudflare.com/?to=/:account/r2>.
   - Create a bucket (e.g. `amass-files-prod`), create an API token with
     read+write on that bucket, and note the endpoint:
     `https://<accountid>.r2.cloudflarestorage.com`.
2. **Backblaze B2**.
   - **Why**: cheaper storage ($0.006/GB-month), free egress only via
     Cloudflare CDN partnership.
   - S3-compatible endpoint: `https://s3.<region>.backblazeb2.com`.

3. **Self-hosted MinIO on Railway**.
   - Possible but defeats the point of going to Railway — no persistent
     volume guarantees beyond the addon defaults, you pay for compute +
     storage, and you re-introduce the operational burden Railway is
     supposed to remove. Recommended only if you have a regulatory
     requirement to keep object storage in-country and neither R2 nor B2
     fits.

Once you have the credentials, set these on the `api` and `ai-worker`
services:

```
MINIO_ENDPOINT       = https://<accountid>.r2.cloudflarestorage.com
MINIO_ACCESS_KEY     = <r2-access-key-id>
MINIO_SECRET_KEY     = <r2-secret-access-key>
MINIO_BUCKET         = amass-files-prod
MINIO_PUBLIC_URL     = https://files.amass-crm.com   # or the R2 public dev URL
```

The "MINIO" name is kept for env-compatibility — the AWS SDK in the API
treats any S3-compatible endpoint identically.

---

## Step 3 — Create the three application services

For each of `api`, `web`, `ai-worker`:

1. Project dashboard → **New** → **GitHub Repo** → pick `amass-crm-v2`.
2. Open the new service → **Settings** → **Source**.
3. Configure:

   | Field                  | Value                                |
   |------------------------|--------------------------------------|
   | Root Directory         | (leave **empty** — see WHY below)    |
   | Branch                 | `main`                               |
   | Config-as-Code Path    | `apps/<service>/railway.toml`        |
   | Watch Paths            | (auto-populated from the toml)       |

**WHY Root Directory must be empty**: the build context must include
`packages/shared/` because the pnpm workspace links `@amass/shared` into
each app. Railway equates Root Directory with the Docker build context;
there is no separate `buildContextPath` field. The per-app `railway.toml`
points `dockerfilePath` at `apps/<svc>/Dockerfile` from the repo root.

Rename each service in the dashboard: `api`, `web`, `ai-worker`.

---

## Step 4 — Set env vars per service

The source of truth is `apps/api/src/config/env.ts` (Zod schema). The api
service fails fast on missing required vars at startup, so use it to
validate locally first:

```bash
NODE_ENV=production node -e "
  require('./apps/api/dist/src/config/env.js').loadEnv()
"
```

Or just run `scripts/check-railway-readiness.sh` — it parses the schema
and prints the checklist.

Required per service (full list with generation commands lives in each
`apps/<svc>/railway.toml`):

### `api` service

```
NODE_ENV=production
DATABASE_URL                 # ref Postgres addon (Railway: ${{Postgres.DATABASE_URL}})
REDIS_URL                    # ref Redis addon    (Railway: ${{Redis.REDIS_URL}})
JWT_SECRET                   # ≥32 chars
JWT_REFRESH_SECRET           # ≥32 chars, different from JWT_SECRET
ENCRYPTION_KEY               # 64 hex chars (32 bytes)
AI_WORKER_SECRET             # ≥16 chars; required in prod
CORS_ALLOWED_ORIGINS         # e.g. https://app.amass-crm.com (no "*"!)
MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET, MINIO_PUBLIC_URL
PUBLIC_API_BASE_URL          # e.g. https://api.amass-crm.com
METRICS_AUTH_TOKEN           # OR METRICS_ALLOWED_IPS (one is required in prod)
SENTRY_DSN                   # optional but strongly recommended
```

Optional integrations are listed in `apps/api/railway.toml`. They are
gated by empty-string-as-absent, so leaving them blank is safe and
disables the corresponding feature.

### `web` service

```
VITE_API_URL=https://api.amass-crm.com/api/v1     # BUILD-TIME — must be set before build
VITE_SENTRY_DSN                                    # optional, build-time
```

The web service runs nginx; `PORT` is auto-injected by Railway and read
by the nginx template at startup.

### `ai-worker` service

```
AI_WORKER_SECRET     # MUST be the same value as on `api`
API_URL              # internal URL of the api service (private networking)
REDIS_URL            # ref the SAME Redis addon as api
MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
WHISPER_MODEL=off    # start with stub; flip to "base" when you provision
                     # a service with ≥2GB RAM
ANTHROPIC_API_KEY    # for summaries
```

### Variable references

In the Railway dashboard you can reference vars across services:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
REDIS_URL    = ${{Redis.REDIS_URL}}
API_URL      = ${{api.RAILWAY_PRIVATE_DOMAIN}}
```

This avoids hardcoding hostnames and survives service re-creation.

---

## Step 5 — Deploy

From the repo root:

```bash
railway link              # if not already linked from `railway init`
railway up                # deploys the linked service from the current dir
```

`railway up` pushes a tar of the working tree (respecting `.dockerignore`)
to Railway's builder, which runs the Dockerfile. The first build of each
service takes 5–10 minutes (cold pnpm install + Prisma generate); subsequent
builds are cached and complete in 1–3 minutes.

You can also deploy via GitHub: every push to `main` triggers a rebuild
of the services whose `watchPaths` matched (set in each `railway.toml`).

---

## Step 6 — Run migrations

Migrations don't run automatically. Once the `api` service is up, from
your laptop:

```bash
# Option A — run against the public URL
DATABASE_URL="$(railway variables --service postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2)" \
  pnpm --filter @amass/api exec prisma migrate deploy

# Option B — run inside the api service
railway run --service api -- pnpm --filter @amass/api exec prisma migrate deploy
```

Then enable pgvector (one-time):

```bash
railway connect postgres
# in psql:
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

---

## Step 7 — Verify health

```bash
# api liveness
curl -fsS https://api.amass-crm.com/api/v1/health
# {"status":"ok","timestamp":"..."}

# api readiness (also pings DB)
curl -fsS https://api.amass-crm.com/api/v1/health/ready

# web
curl -fsSI https://app.amass-crm.com/ | head -1
# HTTP/2 200

# ai-worker (internal — only reachable via Railway private network)
railway run --service ai-worker -- curl -fsS http://localhost:8000/health
# {"status":"ok","sprint":13,...,"degraded": true|false}
```

Run the e2e smoke test against the deployed api:

```bash
scripts/smoke-test.sh https://api.amass-crm.com
```

---

## Custom domain

Railway dashboard → service → **Settings** → **Networking** → **Custom Domain**:

1. Add `app.amass-crm.com` (web) and `api.amass-crm.com` (api).
2. Railway gives you a CNAME target like `xyz.up.railway.app`.
3. In Cloudflare DNS:
   - `app.amass-crm.com` → CNAME → `xyz.up.railway.app` — **DNS only**
     (orange cloud OFF; Railway terminates TLS and proxy mode breaks WS).
   - `api.amass-crm.com` → CNAME → `xyz.up.railway.app` — same.
4. Railway issues a Let's Encrypt cert automatically (~1–2 minutes).

Don't put Cloudflare's proxy in front: Railway already terminates TLS,
and Cloudflare's WS proxying interferes with Socket.IO (used for live
call status updates).

The `ai-worker` doesn't need a public domain — it talks to the api over
Railway's private network. Leave its networking on internal-only.

---

## Rollback

Railway keeps a full deploy history per service. From the dashboard:

1. Open the service → **Deployments** tab.
2. Find the last known-good deploy.
3. Click ⋯ → **Redeploy** (re-runs that exact build's image).

CLI alternative:

```bash
railway status                              # find the deployment ID
railway redeploy <deployment-id>
```

Database migrations are forward-only. If a deploy ships a bad migration:

1. Roll back the **code** via Redeploy (above) — this brings back the
   working api, even though the DB schema is one step ahead.
2. Most additive migrations (new columns, new tables) are backward-compatible
   with the previous code; the rollback typically just works.
3. If the migration was destructive (dropped a column, narrowed a type),
   you need a forward fix — write a new migration that restores the
   schema and redeploy.

---

## Cost expectations

Railway prices = compute (vCPU + RAM) + storage + egress + addons. Order
of magnitude for amass-crm-v2 in **light production** use (single tenant,
low traffic, no real Whisper model):

| Item                           | Monthly (USD) |
|--------------------------------|---------------|
| `api` service (0.5 vCPU, 1GB)  | ~5            |
| `web` service (0.25 vCPU, 0.5GB) | ~3          |
| `ai-worker` (0.5 vCPU, 1GB, WHISPER_MODEL=off) | ~5 |
| Postgres addon (1GB)           | ~5            |
| Redis addon                    | ~5            |
| Cloudflare R2 (10GB + 1M req)  | ~0.50         |
| **Total**                      | **~20–25**    |

This scales roughly linearly. With real Whisper at WHISPER_MODEL=base
(~2GB RAM), the ai-worker line jumps to ~10–15. At `medium` or `large`
(8GB+ RAM) you're looking at ~40+ on the worker alone — at that point
look at running the ai-worker on a Hetzner CX21 (~5 EUR/month, 2 vCPU,
4GB RAM) and keeping the api+web on Railway.

The free trial credit (5 USD) runs out in roughly a week of this stack
sitting idle. Set up a hobby plan ($5/mo + usage) before deploying or
the services get suspended.

---

## Operational notes

- **Logs**: `railway logs --service api` (CLI) or the Logs tab per service.
  Pino structured JSON is forwarded as-is — pipe to `jq` for prettier output.
- **Shell into a running container**: `railway ssh --service api` (requires
  the service to be deployed; useful for ad-hoc Prisma queries).
- **Secrets**: Railway has built-in secret management — set vars via the
  dashboard or `railway variables set FOO=bar --service api`. Never commit
  `.env.production` to git (the `.gitignore` covers `.env*` but double-check).
- **Restart on demand**: Railway dashboard → service → **Settings** →
  **Restart**, or `railway restart --service api`.
- **Scaling**: Railway dashboard → service → **Settings** → **Resources**.
  Switch a service from "Shared CPU" to "Dedicated" or increase the
  memory cap as load grows.

---

## Related docs

- [`SCALING.md`](./SCALING.md) — opt-in scaling primitives (read-replica,
  PgBouncer, Redis Sentinel, breakers, throttling)
- [`../CLAUDE.md`](../CLAUDE.md) — env-var contract + production-only
  validation rules
- `apps/api/src/config/env.ts` — single source of truth for env-var schema
