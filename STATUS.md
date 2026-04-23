# STATUS.md — Stadiul Proiectului Amass CRM v2

> Actualizat: 2026-04-23 | Sprint curent: post-audit remediation — CedarGuard wired on gdpr/deals/invoices, test coverage expanded (195→257 API + 1→30 web), `.dockerignore` added, all 6 prod-deps vulnerabilities patched via overrides (4 HIGH `@xmldom/xmldom` CVEs + 1 HIGH `fast-xml-parser` + 1 moderate `uuid`), raw SQL tenant-id path hardened with parameter-bound `set_config()`.

**Acest fișier e ONEST. Ceea ce e „implementat complet" e cu adevărat funcțional; ceea ce e parțial sau stub e marcat ca atare. Coordonează cu [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) pentru punctele care mai necesită verificare runtime pe Docker real.**

---

## Rezumat rapid

| Indicator | Valoare | Verificare |
|-----------|---------|------------|
| Module backend total | **64** (din care 5 scaffold 501) | `find apps/api/src/modules -mindepth 1 -maxdepth 1 -type d \| wc -l` |
| Module backend funcționale | **59** | subtract SCIM/WebAuthn/Sync/Push/AccessControl scaffolds |
| Modele Prisma (tabele) | **80+** | `grep -c '^model ' apps/api/prisma/schema.prisma` |
| Pagini frontend | **45–49** | `find apps/web/src/routes -name '*.tsx' \| wc -l` — minus 5 lazy wrappers |
| Unit tests API | **257 passing** în 36 fișiere | `pnpm --filter @amass/api test` |
| E2e tests API | **13 fișiere** (necesită Docker: Postgres + Redis + MinIO) | în `apps/api/test/` |
| Web tests | **30 passing** în 6 fișiere | `pnpm --filter @amass/web test` |
| TypeScript errors | **0** (api + web) | `pnpm typecheck` |
| Lint errors | **0** | `pnpm lint` |
| Vulnerabilități `--prod` | **0** (patchuite prin `pnpm.overrides` în `package.json`) | `pnpm audit --prod` — 6 (4 HIGH + 2 moderate) → 0 |
| Vulnerabilități dev-only | **0** | `pnpm audit` (include devDependencies) |
| NestJS | **v11.1.19** (upgradat de la v10.4.x) | `grep @nestjs/core apps/api/package.json` |
| PWA installable | ✅ (manifest + service worker) | `apps/web/public/manifest.webmanifest` |
| Test coverage security-critical | ⚠️ **sub țintă 80%** (CLAUDE.md #8) — vezi §Tech debt | `pnpm --filter @amass/api vitest run --config vitest.config.unit.ts --coverage` |

---

## ✅ Implementat și funcțional

### Core CRM
- [x] Companies (CRUD, search, soft-delete, ierarhie parent/child, multi-tenant)
- [x] Contacts (legate de companies)
- [x] Clients (B2C, portal acces)
- [x] Deals + Pipeline Kanban (stages, probability, WON/LOST)
- [x] Tasks + Reminders (BullMQ delayed jobs, notificare la scadență)
- [x] Notes + Attachments (MinIO storage, presigned URLs)
- [x] Activity Log + Audit Trail (toate mutațiile înregistrate + SIEM forward opțional)

### Vânzări & Revenue
- [x] **Leads** — pipeline prospecți, conversie atomică Lead→Contact+Company+Deal
- [x] Quotes (oferte) cu QuoteLines + aprobare + semnătură portal
- [x] Invoices + InvoiceLines + Payments tracking
- [x] Products + Price Lists + Categories + Variants + Bundles
- [x] Approvals (policy-based, trigger QUOTE_ABOVE_VALUE)
- [x] Lead Scoring (async recompute via BullMQ)
- [x] Forecasting — pipeline ponderat vs quota per user/perioadă
- [x] Contracte (CRUD cu tracking expirare, auto-renewal, PDF pe MinIO)
- [x] Comenzi (Orders) — Q2C cu line items, lifecycle DRAFT→CONFIRMED→FULFILLED
- [x] Campanii Marketing — outreach multi-canal, tracking conversii/ROI/buget
- [x] MRR / ARR / Churn — snapshot per plan
- [x] Comisioane vânzători — planuri, calcul lunar, mark-paid

### Comunicare
- [x] Email (SMTP via nodemailer + tracking deschidere/click)
- [x] Email Sequences (automated multi-step cadences)
- [x] Calls — Twilio outbound + webhook verified signatures + **circuit breaker**
- [ ] ⚠️ **Transcripție Whisper** — DEFAULT OFF (`WHISPER_MODEL=off`). Codul există, dependențele comentate în `requirements.txt`. Fără activare manuală, apelurile primesc placeholder `"[stub transcript]"`.
- [ ] ⚠️ **Redactare PII Presidio** — NU instalat. Fallback = regex stub (CNP/telefon/email română). Pentru Presidio real: uncomment în `requirements.txt` + `python -m spacy download ro_core_news_sm en_core_web_sm`.
- [x] Rezumare AI apel prin Claude (dacă `ANTHROPIC_API_KEY` setat + transcript real)
- [x] WhatsApp (Twilio Business API)
- [x] SMS (Twilio inbound + outbound)
- [x] Notificări real-time (Socket.IO + JWT auth)

### Suport
- [x] Cazuri Suport (Cases/Tickets) — auto-numerotare, prioritate, SLA, asignare
- [x] SLA Escalation — cron 15min, NORMAL→HIGH→URGENT

### Integrări & Platform
- [x] Calendar (Google + Outlook CalDAV sync)
- [x] ANAF e-Factura — cod real, OAuth2, UBL 2.1 XML, cu **circuit breaker**
- [x] SSO/SAML (enterprise auth prin `@node-saml/passport-saml`)
- [x] Webhooks outbound (HMAC-SHA256 signing, `WebhookDelivery` retry log)
- [x] Stripe Billing (subscriptions + webhooks + **circuit breaker**)
- [x] **Multi-tenancy defense in depth** — 3 straturi reale, documentate în [docs/SCALING.md](./docs/SCALING.md):
  1. `JwtAuthGuard` + `RolesGuard` + `TenantContextMiddleware` (ALS)
  2. `tenantExtension` aplicat prin `$extends` (Layer 2 real, nu cod mort)
  3. Postgres RLS (`SET LOCAL app.tenant_id` + `SET LOCAL ROLE app_user`)
- [x] RBAC (OWNER, ADMIN, MANAGER, AGENT, VIEWER)
- [x] GDPR (consent, data export, right to erasure)
- [x] Custom Fields + Formula Fields + Validation Rules
- [x] Contact Segments (filtre dinamice)
- [x] Report Builder (custom reports cu allowlist coloane)
- [x] Data Export (CSV async BullMQ)
- [x] Duplicate Detection
- [x] GestCom Importer
- [x] Client Portal (link acces clienți, semnare oferte)
- [x] AI Enrichment (Claude + circuit breaker)
- [x] Sentry (error monitoring API + Web)
- [x] OpenAPI/Swagger auto-generat
- [x] Chatter intern (feed polimorfic pe subiecte)
- [x] Events management (conferințe/webinare + tracking prezență)
- [x] Territory management (zone geografice/industrii + asignare)

### Scaling primitives (wired, opt-in via env)
- [x] Read-replica routing (`DATABASE_REPLICA_URL` + `runWithTenant('ro')`)
- [x] PgBouncer service în compose (profile `prod`)
- [x] Redis Sentinel support (`REDIS_SENTINEL_HOSTS` + `_MASTER`)
- [x] Per-tenant throttler (`TenantThrottlerGuard` keys pe tenantId+userId)
- [x] Circuit breakers — Twilio, Anthropic, Gemini, OpenAI, Stripe, ANAF, SIEM
- [x] `GET /health/detailed` — DB + Redis + breakers status

### Scaffolds explicite (NU IMPLEMENTATE, placeholder pentru roadmap)
- [ ] `ScimModule` — `/api/v1/scim/v2/*` returnează 501 cu envelope SCIM
- [ ] `WebauthnModule` — `/api/v1/webauthn/*` returnează 501
- [ ] `SyncModule` — `GET /api/v1/sync` returnează 501
- [ ] `PushModule` — `PushService.send()` e no-op log
- [ ] `AccessControlModule` — `ConditionalAccessMiddleware` pass-through, `CedarPolicyService.check()` default-allow

### Frontend (45–49 pagini)
- [x] Dashboard (cu KPI reale din `/reports/dashboard`)
- [x] Companies + Contacts + Clients (list + detail)
- [x] Leads (list + conversie)
- [x] Deals Kanban
- [x] Contracte, Forecasting, Cases, Orders, Campaigns
- [x] Abonamente/MRR, Comisioane, Teritorii, Evenimente
- [x] PWA installable (manifest + service worker)
- [x] Tasks, Reminders, Invoices, Quotes, Products, Projects
- [x] Calendar, Email/Phone/WhatsApp/SMS settings+inbox
- [x] Reports, Report Builder, Approvals, Audit Trail
- [x] Custom Fields, Webhooks, Billing, Contact Segments, Email Sequences
- [x] Exports, Duplicates, Search, Settings (Users, 2FA)

---

## 🔧 Necesită verificare manuală înainte de launch

Vezi **[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md)** pentru lista completă. Punctele critice încă nebifate:

- §1.1 — Smoke test pe Docker real (migrații + healthchecks)
- §1.2–1.3 — Flow end-to-end Twilio webhook + AI worker callback
- §1.4 — Semnătură Twilio webhook în prod
- §3 — RLS policies per tabel (audit rulat o dată la 2026-04-14, necesită re-run după modele noi)
- §5 — Setări .env.production (ENCRYPTION_KEY fresh, JWT secrets ≥32 chars, AI_WORKER_SECRET)

---

## ❌ Tech debt cunoscut (nu blocker pentru launch)

| Loc | Problemă |
|-----|----------|
| `ai-worker/app/transcription.py` | Whisper dezactivat default (stub) — feature opt-in |
| `ai-worker/app/redaction.py` | Presidio dezactivat (regex stub) — feature opt-in |
| `apps/api/test/` | 13 e2e specs necesită Docker up (Postgres + Redis + MinIO live) |
| `apps/web` | Bundle > 500KB — code splitting parțial (lazy routes pentru Tier 2/3) |
| 5 module scaffold | SCIM/WebAuthn/Sync/Push/CA — marcate explicit ca nu-implementate |
| Test coverage security-critical | **Sub ținta 80% din CLAUDE.md #8** — măsurare curentă: overall ~15% linii / ~34% funcții, cu module critice notabil sub ținta (auth.service ~13%, audit.service ~2%, calls.service ~0% unit, deals.service ~0% unit, invoices.service ~0% unit, billing.service ~18%). Target pentru v1 launch: ≥80% pe auth/billing/calls/invoices/deals/audit/prisma. Plan: helper-extraction pattern (pattern deja folosit pentru billing/anaf/reports/calls/gdpr/embedding) + spec-uri noi. |
| CedarGuard policy coverage | **3/64 controllere** (`gdpr`, `deals`, `invoices`) au `@RequireCedar` metadata. Restul sunt protejate doar prin RolesGuard — Cedar e scaffold până se scriu policies reale. |
| 6 modele fără `tenantId` explicit | `Tenant` (self-scope OK), `WebhookDelivery`, `OrderItem`, `ProductBundleItem`, `TerritoryAssignment`, `EventAttendee` — toate sub-resurse cu `onDelete: Cascade` + RLS pe parent. Nu e leak direct dar e fragilitate dacă rol `app_user` vreodată nu-i activ. |
| 45/79 modele fără `onDelete: Cascade` | Risc orfani la ștergere. De auditat relațiile — schema necesită review dedicat. |
| `prisma.service.ts` SET LOCAL ROLE | `$executeRawUnsafe("SET LOCAL ROLE app_user")` — identifier hardcodat, nu user input. Acceptabil (injection-proof prin natura valorii). Pentru `app.tenant_id` s-a migrat la `set_config()` parametrizat. |

---

## 📁 Structura fișierelor cheie

```
apps/api/src/modules/    — 64 module NestJS (59 funcționale + 5 scaffolds)
apps/api/prisma/         — schema.prisma (80+ modele) + 29 migrări
apps/web/src/routes/     — 54 fișiere .tsx (~45-49 pagini + 5 lazy wrappers)
apps/web/src/features/   — API clients frontend (TanStack Query)
apps/web/public/         — manifest.webmanifest + sw.js + icons (PWA)
apps/ai-worker/          — FastAPI + BullMQ consumer (Python)
packages/shared/         — Zod schemas comune BE+FE
docs/SCALING.md          — primitives de scaling + defense-in-depth
.github/workflows/ci.yml — CI (lint + typecheck + build + e2e)
```
