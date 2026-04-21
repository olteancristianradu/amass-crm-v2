# AMASS CRM v2 — Ghid tehnic developer

CRM multi-tenant B2B+B2C cu voice intelligence (apeluri transcrise, rezumate AI, redactare PII). Construit pentru IMM-uri românești și EU.

**Versiune:** Tier B+C complete · **Stack:** NestJS + Prisma + Postgres + React · **Solo developer.**

> Pentru manualul utilizatorului final (conducere companie), vezi **[README-CEO.md](./README-CEO.md)**.
> Pentru catalogul tuturor funcțiilor vezi **[docs/FEATURES.md](./docs/FEATURES.md)**.
> Pentru checklist-ul de launch vezi **[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)**.

---

## Cuprins

1. [Stack complet](#1-stack-complet)
2. [Arhitectura](#2-arhitectura)
3. [Setup local](#3-setup-local)
4. [Variabile de mediu](#4-variabile-de-mediu)
5. [Structura monorepo](#5-structura-monorepo)
6. [Multi-tenancy (3 straturi)](#6-multi-tenancy-3-straturi)
7. [Convenții API REST](#7-conventii-api-rest)
8. [Cum adaugi un feature nou](#8-cum-adaugi-un-feature-nou)
9. [Testing](#9-testing)
10. [CI/CD](#10-cicd)
11. [Deployment VPS (producție)](#11-deployment-vps)
12. [Gestionare conturi și integrări](#12-gestionare-conturi)
13. [Debugging & troubleshooting](#13-debugging)
14. [Cum repari erorile comune](#14-reparare-erori)

---

## 1. Stack complet

**Backend:** Node 22 · NestJS 10 · TypeScript 5 strict · Prisma 6 · Zod · Vitest · Pino · JWT+sessions+TOTP

**Data:** Postgres 16 + pgvector + pg_trgm · Redis 7 · BullMQ · MinIO · Postgres tsvector (NU Meilisearch)

**AI:** Python 3.12 + FastAPI · Whisper / whisperX · Presidio · Claude `claude-sonnet-4-6` · OpenAI embeddings (text-embedding-3-small)

**Frontend:** React 19 · Vite · TanStack Router/Query/Table · shadcn/ui + Tailwind · React Hook Form + Zod · Zustand · Socket.IO client

**Infra:** Docker Compose (NU k8s) · Caddy · Twilio · pnpm + Turborepo · GitHub Actions · Sentry · Pino + Prometheus + OTel

**Explicit NU folosim:** Kubernetes, Kafka, microservices, GraphQL, MongoDB, Meilisearch, Redux.

---

## 2. Arhitectura

### Principii de design

1. **Monolit modular** — un singur API NestJS cu 63 module. Simplitate > microservices pentru solo dev.
2. **Multi-tenancy in-row** — toate tabelele au `tenant_id`. RLS + middleware garantează izolarea.
3. **Outbox pattern** — evenimente scrise în DB în aceeași tranzacție, consumate async de Redis Streams.
4. **Idempotent consumers** — toate jobs-urile BullMQ suportă retry fără efecte duble.
5. **Presigned URLs** pentru binare — frontend upload direct spre MinIO, backend primește doar metadata.
6. **Zod everywhere** — schema-uri partajate BE+FE în `packages/shared`.

### Diagramă componente

```
┌─────────────┐     HTTPS      ┌──────────────┐
│   Browser   │◄──────────────►│    Caddy     │
│   (React)   │                │ reverse proxy│
└─────────────┘                └──────┬───────┘
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
              ┌────────────┐   ┌────────────┐   ┌────────────┐
              │  NestJS    │   │ AI Worker  │   │  Static    │
              │   API      │   │  FastAPI   │   │   Web      │
              │  :3000     │   │   :8000    │   │   :3001    │
              └──────┬─────┘   └──────┬─────┘   └────────────┘
                     │                │
        ┌────────────┼────────────┐   │
        ▼            ▼            ▼   ▼
    ┌────────┐  ┌────────┐  ┌──────────┐
    │Postgres│  │ Redis  │  │  MinIO   │
    │  +pgv  │  │+BullMQ │  │(S3-like) │
    └────────┘  └────────┘  └──────────┘
```

---

## 3. Setup local

### Prerequisite
- Node 22+ (`fnm use 22`)
- pnpm 9+
- Docker + Docker Compose
- Git

### Pași

```bash
git clone https://github.com/olteancristianradu/amass-crm-v2.git
cd amass-crm-v2

pnpm install

docker compose -f infra/docker-compose.dev.yml up -d

cp apps/api/.env.example apps/api/.env
# Completează variabilele (secțiunea 4)

cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
pnpm prisma db seed
cd ../..

pnpm dev
# API:  http://localhost:3000/api/v1
# Web:  http://localhost:3001
# Swagger: http://localhost:3000/api/docs
# MinIO: http://localhost:9001
```

### Comenzi utile

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format

pnpm --filter @amass/api dev
pnpm --filter @amass/web dev
pnpm --filter @amass/api test -- --watch
```

---

## 4. Variabile de mediu

Toate validate cu Zod la startup — **fail fast** dacă lipsește ceva obligatoriu.

`apps/api/.env`:

```env
# Core
NODE_ENV=development
DATABASE_URL=postgresql://crm_user:PAROLA@localhost:5432/amass_crm
REDIS_URL=redis://localhost:6379
JWT_SECRET=                # openssl rand -hex 64
SESSION_SECRET=            # openssl rand -hex 64
ENCRYPTION_KEY=            # openssl rand -hex 32

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=amass-crm
MINIO_USE_SSL=false

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=+40...

# Email
SENDGRID_API_KEY=
EMAIL_FROM=noreply@amass.ro

# AI (opțional)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=

# Monitoring
SENTRY_DSN=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ANAF
ANAF_CLIENT_ID=
ANAF_CLIENT_SECRET=

# SSO SAML
SAML_IDP_METADATA_URL=
SAML_SP_ENTITY_ID=
```

`apps/web/.env`:

```env
VITE_API_URL=http://localhost:3000/api/v1
VITE_SOCKET_URL=http://localhost:3000
VITE_SENTRY_DSN=
```

---

## 5. Structura monorepo

```
amass-crm-v2/
├── apps/
│   ├── api/                 # NestJS backend
│   │   ├── prisma/          # schema + migrări
│   │   └── src/
│   │       ├── config/      # Zod env loader
│   │       ├── infra/       # Prisma, Redis, MinIO, Queue
│   │       ├── common/      # pagination, filters
│   │       └── modules/     # 63 module
│   ├── web/                 # React frontend
│   │   ├── public/          # PWA manifest + SW
│   │   └── src/
│   │       ├── routes/      # 48 pagini
│   │       ├── features/    # API clients
│   │       ├── components/  # ui + layout
│   │       ├── lib/
│   │       ├── stores/      # Zustand
│   │       └── hooks/
│   └── ai-worker/           # FastAPI Python
├── packages/
│   └── shared/              # Zod schemas BE+FE
├── infra/
│   ├── docker-compose.dev.yml
│   └── docker-compose.prod.yml
├── docs/
│   ├── ARCHITECTURE.md
│   └── FEATURES.md
├── .github/workflows/ci.yml
├── CLAUDE.md
├── LESSONS.md
├── LAUNCH_CHECKLIST.md
├── STATUS.md
├── README.md
├── README-CEO.md
└── pnpm-workspace.yaml
```

---

## 6. Multi-tenancy (3 straturi)

**Defense in depth.** Dacă un strat pică, următoarele te acoperă.

### Stratul 1: TenantGuard (NestJS)
Extrage `tenantId` din JWT și-l stochează în AsyncLocalStorage.

```typescript
export const tenantStorage = new AsyncLocalStorage<TenantContext>();
export const requireTenantContext = () => {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('No tenant context');
  return ctx;
};
```

### Stratul 2: Prisma middleware
Interceptează orice query și adaugă `WHERE tenantId = <current>`.

### Stratul 3: Postgres RLS
Ultimul cordon — chiar dacă scrii raw SQL fără filtru:

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies
  USING (tenant_id = current_setting('app.tenant_id')::text);
```

### Stratul 4 (audit)
Orice cross-tenant attempt → loggat în `audit_logs` cu level ERROR.

---

## 7. Convenții API REST

- Toate rutele sub `/api/v1/`
- **Cursor pagination:** `?cursor=abc&limit=50`
- **Filtrare:** `?filter[status]=OPEN&filter[priority]=HIGH`
- **Sortare:** `?sort=-createdAt`
- **Response paginat:** `{ items: [...], nextCursor: "xyz" | null }`
- **Eroare standard:**
  ```json
  {
    "code": "COMPANY_NOT_FOUND",
    "message": "Company not found",
    "details": {},
    "traceId": "uuid-v4",
    "timestamp": "2026-04-21T10:30:00Z"
  }
  ```
- **OpenAPI** la `/api/docs` (dev only)
- **Rate limiting:** 60 req/min/IP default, 5/min pe `/auth/login`

---

## 8. Cum adaugi un feature nou

Loop strict din `CLAUDE.md`:

1. **Plan** (≤15 linii) → cere aprobare
2. **Schema Prisma** → `pnpm prisma migrate dev --name add_my_feature`
3. **Zod schema** în `packages/shared/src/schemas/`
4. **Service** în `apps/api/src/modules/my-feature/`
5. **Controller** cu `@UseGuards(JwtAuthGuard, TenantGuard)`
6. **Module** cu imports corecte
7. Înregistrează în `app.module.ts`
8. **Tests** Vitest (unit + integration)
9. **Frontend:** feature client + pagină + link în `AppShell.tsx`
10. `pnpm lint && pnpm test` → verzi
11. Verificare e2e — paste evidence
12. Commit: `feat(my-feature): add CRUD`

---

## 9. Testing

```bash
pnpm --filter @amass/api test
pnpm --filter @amass/web test
pnpm --filter @amass/api test:e2e  # testcontainers Postgres real
```

**Target coverage:** ≥80% pe services (CLAUDE.md regulă #8).

---

## 10. CI/CD

`.github/workflows/ci.yml` — 3 jobs:

| Job | Ce face | Durată |
|-----|---------|--------|
| `lint-typecheck-build` | ESLint + tsc + build | ~3 min |
| `test-api` | Unit + integration cu Postgres+Redis | ~5 min |
| `test-web` | Vitest + Testing Library | ~2 min |

**Trigger:** push pe `main` + toate PR-urile.

---

## 11. Deployment VPS

### 11.1 VPS
- Minim: 4 vCPU, 8 GB RAM, 100 GB SSD
- Recomandat: Hetzner CX31 (~10 EUR/lună) sau DO Droplet 4GB
- OS: Ubuntu 24.04 LTS

### 11.2 DNS
```
crm.amass.ro  → IP_VPS
api.amass.ro  → IP_VPS
```

### 11.3 Docker + pnpm + Node
```bash
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin
curl -fsSL https://fnm.vercel.app/install | bash
fnm use 22
npm i -g pnpm
```

### 11.4 Firewall
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
# 5432/6379/9000 NU expuse public!
```

### 11.5 Postgres + extensii
```bash
psql -U postgres -c "CREATE USER crm_user WITH PASSWORD 'PAROLA';"
psql -U postgres -c "CREATE DATABASE amass_crm OWNER crm_user;"
psql -U crm_user -d amass_crm -c "CREATE EXTENSION IF NOT EXISTS pgvector;"
psql -U crm_user -d amass_crm -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
```

### 11.6 MinIO
```bash
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=ACCESS \
  -e MINIO_ROOT_PASSWORD=SECRET \
  -v /data/minio:/data \
  quay.io/minio/minio server /data --console-address ":9001"
# Creează bucket 'amass-crm' privat din http://IP:9001
```

### 11.7 Caddy (HTTPS automat)
```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/debian.bookworm main" | tee /etc/apt/sources.list.d/caddy.list
apt update && apt install caddy
```

`/etc/caddy/Caddyfile`:
```
crm.amass.ro {
  reverse_proxy localhost:3001
}
api.amass.ro {
  reverse_proxy localhost:3000 {
    transport http {
      read_timeout 120s
      write_timeout 120s
    }
  }
}
```

```bash
systemctl enable --now caddy
```

### 11.8 Backup Postgres
```bash
cat > /usr/local/bin/pg-backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U crm_user amass_crm | gzip > /backups/amass_crm_$DATE.sql.gz
find /backups -name "*.sql.gz" -mtime +30 -delete
EOF
chmod +x /usr/local/bin/pg-backup.sh
mkdir -p /backups
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/pg-backup.sh") | crontab -
```

### 11.9 Primul tenant
```bash
cd apps/api && pnpm prisma db seed
# sau:
curl -X POST https://api.amass.ro/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@amass.ro","password":"PAROLA","firstName":"Admin","lastName":"AMASS","tenantName":"AMASS SRL"}'
```

---

## 12. Gestionare conturi

### 12.1 Twilio
1. Cont [twilio.com](https://twilio.com) → număr RO Voice+SMS
2. Webhook Voice inbound: `https://api.amass.ro/api/v1/calls/twilio/incoming`
3. Webhook status: `https://api.amass.ro/api/v1/calls/twilio/status`
4. Copiază SID + AUTH_TOKEN în `.env`

### 12.2 SendGrid
1. Cont [sendgrid.com](https://sendgrid.com)
2. Domain Authentication (DNS: DKIM + SPF) pentru `amass.ro`
3. API Key cu `Mail Send` → `.env`

### 12.3 Sentry
1. [sentry.io](https://sentry.io) → proiecte separate Node.js + React
2. DSN backend + DSN frontend în env

### 12.4 Stripe
1. [stripe.com](https://stripe.com) → Products + Prices
2. Webhook: `https://api.amass.ro/api/v1/billing/webhooks/stripe`
3. Secrete în `.env`

### 12.5 ANAF e-Factura
1. [anaf.ro](https://anaf.ro) → SEF → OAuth2 client
2. Credentials în `.env`

### 12.6 OAuth Google/Microsoft
Calendar sync = consent user individual; nu config global.

---

## 13. Debugging

### Backend
- **Logs:** Pino JSON; în dev → `pino-pretty`
- **Sentry:** 5xx trimis automat
- **Trace ID:** UUID propagat în logs + error response

### Frontend
- **React DevTools** + TanStack Router DevTools
- **Sentry React** cu breadcrumbs

### DB
- **Prisma Studio:** `pnpm prisma studio`
- **psql / pgAdmin** pentru prod

### Observability
- `/metrics` expune Prometheus
- OTel pentru distributed tracing (opțional)

---

## 14. Reparare erori

### `Stream idle timeout - partial response received`
**Cauză:** Claude API stream întrerupt de proxy/network.
**Fix aplicat:** `new Anthropic({ timeout: 90_000, maxRetries: 2 })` în `enrichment.service.ts` + `deal-ai.service.ts`.
**Dacă persistă:** crește `read_timeout` Caddy la 180s.

### `ERR_PNPM_OUTDATED_LOCKFILE`
**Fix:** `pnpm install --lockfile-only`, commit `pnpm-lock.yaml`.

### `No tenant context` în service
**Fix:** verifică `@UseGuards(TenantGuard)` pe controller.

### Migration refuză drop coloană în prod
**Fix:** expand-contract — nullable întâi, deploy, apoi drop.

### BullMQ job repetă la infinit
**Fix:** try/catch în handler, rethrow doar errors recuperabile.

### Prisma `P2002 Unique constraint failed`
**Fix:** catch în service → `ConflictException` cu mesaj friendly.

### Frontend 401 după refresh token expirat
**Fix:** interceptor axios reîncearcă o dată cu refresh; eșec → redirect `/login`.

### MinIO presigned URL 403 SignatureMismatch
**Cauză:** clock skew > 15min.
**Fix:** `timedatectl set-ntp true` pe VPS.

---

## Resurse

- [CLAUDE.md](./CLAUDE.md)
- [LESSONS.md](./LESSONS.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/FEATURES.md](./docs/FEATURES.md)
- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)

---

*Ultima actualizare: 2026-04-21*
