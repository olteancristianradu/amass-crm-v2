# AMASS CRM

> **Multi-tenant CRM for Romanian SMBs. ANAF e-Factura native. Onboarding under 1 hour.**

[![CI](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/ci.yml)
[![CodeQL](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/codeql.yml/badge.svg)](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/codeql.yml)
[![Secret Scan](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/olteancristianradu/amass-crm-v2/actions/workflows/secret-scan.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Built with NestJS](https://img.shields.io/badge/built%20with-NestJS-E0234E)](https://nestjs.com/)
[![Built with React](https://img.shields.io/badge/built%20with-React_19-61DAFB)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)

---

## What is this

A modern CRM built for the segment Salesforce won't serve well: **5–50 person SMBs in Romania and the EU** that need real sales tooling without the $150/user/month price tag, the 6-week onboarding, or the certified-admin dependency.

Native ANAF e-Factura. GDPR by default. Multi-tenant with row-level security. Single docker-compose to spin it up.

## Live demo

> **Try it:** [https://affiliation-rated-tattoo-exports.trycloudflare.com](https://affiliation-rated-tattoo-exports.trycloudflare.com)
> Demo tenant: `demo` · email: `admin@amass-demo.ro` · password: `AmassCRM2026!`
>
> ⚠️ The demo URL is a Cloudflare quick tunnel — it can rotate. If it doesn't load, ping the maintainer for the current URL.

## Why it might matter to you

| You are… | What this gives you |
|---|---|
| **Romanian SMB owner** | ANAF e-Factura submission built-in, GDPR exports one-click, onboarding under 1 hour, Romanian UI |
| **Developer evaluating CRMs** | Modern stack (NestJS 11 + Prisma 6 + React 19 + BullMQ), multi-tenancy done right (3 layers: middleware + Prisma extension + Postgres RLS), 1000+ tests, audit log on everything |
| **Security/compliance reviewer** | RLS deny-by-default, JWT 15-min + refresh rotation with reuse detection, audit log, Cedar policies (ABAC), TOTP 2FA, SCIM-ready |
| **Founder considering fork** | AGPL-3.0 license — fork freely, but if you ship a SaaS competitor your modifications must be open-sourced too |

## Features at a glance

**CRM core** — Companies, Contacts, Clients (split B2B/B2C), Deals with pipelines + Kanban DnD, Tasks, Reminders, Notes (polymorphic timeline), Attachments via MinIO.

**Sales** — Leads + scoring, Quotes, Invoices (with ANAF e-Factura submission), Products, Approval policies, Forecasting, Contracts, Orders, Campaigns.

**Communication** — Email (SMTP + Outlook/Microsoft Graph + tracking pixel + reply detection), Calls (Twilio + AI transcription via Whisper + summary via Claude/Gemini), SMS, WhatsApp, Sequences, Calendar (Google + Outlook OAuth).

**Romanian compliance** — ANAF e-Factura UBL XML submission + status tracking, CNP/IBAN validation, GDPR data export + deletion + retention policies, audit log with SIEM forwarding.

**Platform** — Multi-tenant with Postgres RLS, RBAC + Cedar policies, TOTP 2FA, JWT + refresh rotation, BullMQ queues, Redis Sentinel ready, PgBouncer ready, Prometheus metrics, Sentry integration, Pino structured logging.

**Frontend** — ~75 pages, glass-morphism design system, Cmd+K command palette, AI morning brief, dark mode, PWA, real-time WebSocket notifications.

Full feature catalogue: [`docs/FEATURES.md`](./docs/FEATURES.md).

## Quick start (5 minutes)

```bash
# 1. Clone
git clone https://github.com/olteancristianradu/amass-crm-v2.git
cd amass-crm-v2

# 2. Copy env template
cp infra/.env.example infra/.env
# Edit if you want; defaults work for local dev.

# 3. Start the stack (postgres, redis, minio, api, web, ai-worker, caddy)
docker compose -f infra/docker-compose.yml up -d

# 4. Run migrations + seed demo data
docker exec amass-api pnpm exec prisma migrate deploy
docker exec amass-api pnpm exec prisma db seed

# 5. Open http://localhost in your browser
# Login: admin@amass-demo.ro / AmassCRM2026!
```

Detailed setup, environment variables, and architecture: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## Architecture in 30 seconds

```
Browser  →  Caddy (reverse proxy, HTTPS in prod)
              ├─ /api/*    → NestJS API (Node 22)
              ├─ /ai/*     → FastAPI AI worker (Python 3.12)
              ├─ /ws/*     → Socket.IO for realtime notifications
              ├─ /amass-files/*  → MinIO (presigned uploads/downloads)
              └─ /         → React 19 SPA (Vite)

API ─┬─ Postgres 16 (data + RLS + tsvector full-text)
     ├─ Redis 7 (BullMQ queues, sessions, rate limiter)
     └─ MinIO (binary storage)
```

**Multi-tenancy is enforced in three layers:**
1. `JwtAuthGuard + TenantContextMiddleware` populate AsyncLocalStorage with tenant context.
2. `runWithTenant(tenantId, fn)` opens a Prisma transaction with a tenant extension that auto-injects `tenantId` into every query.
3. Postgres RLS policies enforce `tenant_id = current_tenant_id()` at the database row level. RLS is **deny-by-default** when tenant context is missing (no fail-open OR clause).

Full architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Scaling primitives: [`docs/SCALING.md`](./docs/SCALING.md).

## Testing & quality

- **973+ unit tests** in the API, **52+ web tests**, full e2e suite (1087+ tests at last run).
- Lint, typecheck, tests, dependency audit, secret scan, and CodeQL run on every push.
- RLS deny-by-default has its own regression test (`apps/api/test/multi-tenant.e2e.spec.ts`).
- Critical CRM browser flow runs in Playwright (auth, company CRUD, attachment upload+download with byte comparison, task complete, reminder dismiss).

Run locally:
```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Project status

This is **alpha**. Production deployment, real provider credentials (Twilio, Stripe, Google OAuth, Microsoft Graph, Anthropic, ANAF), and operational readiness (backups, monitoring, on-call) are still in progress.

Current honest readiness:
- Code/tests/security: ~80% verified
- Production deploy: 0% (no domain, no VPS, demo URL is a Cloudflare quick tunnel)
- Real provider integrations: blocked on credentials

Launch gate: [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md). Recent changes: [`CHANGELOG.md`](./CHANGELOG.md). Past mistakes worth remembering: [`LESSONS.md`](./LESSONS.md).

## Roadmap

- [x] Core CRM (companies, contacts, deals, tasks, notes, attachments)
- [x] Sales (leads, quotes, invoices, products, approvals, forecasting)
- [x] Communication (email, calls, SMS, WhatsApp, sequences, calendar)
- [x] ANAF e-Factura native submission
- [x] Multi-tenant RLS deny-by-default
- [x] Polymorphic tags
- [x] Microsoft Graph email integration
- [ ] Multi-format importer (CSV, Excel, SmartBill, SAGA, GestCom, PDF)
- [ ] Pro Cockpit — selectable widget dashboard
- [ ] Performance budgets in CI
- [ ] Production deployment with stable domain
- [ ] AppExchange-style marketplace integrations (Stripe, eMag, Termene.ro, Listafirme)

## Contributing

This is currently a solo-dev project, but PRs are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

For agents (Claude Code, Codex, etc.) working on this codebase, the operating rules are in [`AGENTS.md`](./AGENTS.md). Read it first.

## License

[AGPL-3.0](./LICENSE).

If you fork this and ship a hosted SaaS based on it, your modifications must be open-sourced under AGPL-3.0 too. Commercial dual licensing is available — open an issue.

---

<sub>Built in 🇷🇴 Romania for Romanian SMBs first. EU compliance is in the bones, not bolted on.</sub>
