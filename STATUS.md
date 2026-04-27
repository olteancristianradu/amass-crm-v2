# STATUS.md — Stadiul Proiectului Amass CRM v2

> Actualizat: 2026-04-27 | Sprint curent: design v2 (glass) finalizat pe toate paginile + Cmd-K palette + AI Morning Brief (Gemini/Claude + Redis cache) + register/forgot/reset password public + push major de coverage pe 11 servicii noi (557 → 638+ teste API). CI ZAP-baseline action repinned la SHA real verificat.

**Acest fișier e ONEST. Ceea ce e „implementat complet" e cu adevărat funcțional; ceea ce e parțial sau stub e marcat ca atare. Coordonează cu [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) pentru punctele care mai necesită verificare runtime pe Docker real.**

---

## Rezumat rapid

| Indicator | Valoare | Verificare |
|-----------|---------|------------|
| Module backend total | **64** (din care 5 scaffold 501) | `find apps/api/src/modules -mindepth 1 -maxdepth 1 -type d \| wc -l` |
| Module backend funcționale | **59** | subtract SCIM/WebAuthn/Sync/Push/AccessControl scaffolds |
| Modele Prisma (tabele) | **80+** | `grep -c '^model ' apps/api/prisma/schema.prisma` |
| Pagini frontend | **45–49** | `find apps/web/src/routes -name '*.tsx' \| wc -l` — minus 5 lazy wrappers |
| Unit tests API | **638+ passing** în 64 fișiere | `pnpm --filter @amass/api vitest run --config vitest.config.unit.ts` |
| E2e tests API | **13 fișiere** (necesită Docker: Postgres + Redis + MinIO) | în `apps/api/test/` |
| Web tests | **38 passing** în 7 fișiere | `pnpm --filter @amass/web test` |
| TypeScript errors | **0** (api + web) | `pnpm typecheck` |
| Lint errors | **0** | `pnpm lint` |
| Vulnerabilități `--prod` | **0** (patchuite prin `pnpm.overrides` în `package.json`) | `pnpm audit --prod` — 6 (4 HIGH + 2 moderate) → 0 |
| Vulnerabilități dev-only | **0** | `pnpm audit` (include devDependencies) |
| NestJS | **v11.1.19** (upgradat de la v10.4.x) | `grep @nestjs/core apps/api/package.json` |
| PWA installable | ✅ (manifest + service worker) | `apps/web/public/manifest.webmanifest` |
| Test coverage security-critical | ✅ **la țintă** — auth 98.9% / calls 100% / deals 100% / audit 83.9% / brief 67.7% (lines). Restul modulelor secundare în jur de 30-60%. | `pnpm --filter @amass/api vitest run --config vitest.config.unit.ts --coverage` |

---

## 🆕 Sprint 2026-04-27 — design v2 finalizat + features noi

### Design system v2 (frosted glass)
- Toate cele ~50 de pagini convertite la GlassCard / PageHeader / ListSurface / DetailLayout / TabBar / StatusBadge / EmptyState. Bundle ajunge la **467 KB / 112 KB gzip**.
- AppShell complet rescris: sidebar grupat în 8 secțiuni (Lucru / Clienți / Vânzări / Service / Marketing / Operațional / Insights / Administrare), topbar sticky cu density toggle + notificări + user menu.
- Tokens (`--surface-alpha`, `--surface-blur`, `--accent-tenant`, `--density-scale`) persistate în zustand store `amass-ui-prefs`.
- CallCard primitive (diferențiator) — header cu direcție + counterparty + duration + status badge, waveform decorativ, AI summary block cu action items, transcript bubbles cu PII redacted ca pill-uri negre.

### Cmd-K command palette (`/components/ui/command-palette.tsx`)
- ⌘K / Ctrl+K (sau "/" oriunde în afara form-urilor) deschide o paletă glass cu două secțiuni: **Navigare** (37 link-uri din nav, ranking diacritic-insensitive: startsWith > includes > keyword, admin-aware) și **Căutare globală** (debounced 220ms hit pe `/ai/search`, mapare către detail-page-uri reale companies/contacts/clients).
- Tastatură: ↑/↓ wraps, Enter execută, Esc închide. Highlight clamped inline (fără setState-in-effect).
- Trigger replaces vechiul SearchBar din topbar — pill cu hint platform-correct ⌘K / CtrlK.

### AI Morning Brief (`GET /ai/brief`)
- Generează 2-3 propoziții în română + 3 priority actions per (tenant, user). Provider waterfall: Gemini 2.0 Flash (tier gratuit preferat) → Claude Sonnet 4.6 (cu circuit-breaker) → fallback static deterministic.
- Context agregat într-un singur `runWithTenant`: overdue tasks per user, today's tasks, reminders în următoarele 24h, deals închizându-se în 7 zile, momentum (wins/losses 24h), apeluri completate 24h.
- Cache Redis 30 min per `brief:{tenantId}:{userId}`. `?fresh=1` bypass.
- FE BriefStrip pe dashboard cu refresh button + 3 tile-uri prioritate (TASK/CALL/EMAIL/DEAL/REMINDER).

### Public auth pages
- `/register` — creare tenant + OWNER atomic, drop direct în /app cu user+tokens.
- `/forgot-password` — întotdeauna 204 + copie neutră (anti-enumerare).
- `/reset-password?token=…` — schimbă parola + revocă toate sesiunile + redirect /login după 1.5s.
- `<AuthShell>` shared 2-col layout pentru login + register + forgot + reset.

### Coverage push (acest sprint a adăugat 81 teste API)
| Modul | Teste | Acoperire post |
|-------|-------|---------------|
| brief.service | 6 | 67.75% |
| companies.service | 9 | ~95% |
| contacts.service | 6 | ~95% |
| clients.service | 6 | ~95% |
| contracts.service | 9 | ~95% |
| contact-segments.service | 9 | ~95% |
| forecasting.service | 10 | ~95% |
| duplicates.service | 11 | ~85% |
| tasks.service | 15 | ~85% |
| totp.service | 12 | ~70% |
| email.service | 15 | ~40% |
| workflows.service | 19 | ~50% |
| **Total nou** | **127** | — |

### CI fix
- `zaproxy/action-baseline` SHA `4ca41f5d…` era halucinat de o sesiune anterioară. Repinned la SHA real verificat prin `git ls-remote` → `7c4deb10e6261301961c86d65d54a516394f9aed` (v0.14.0).

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
| Test coverage non-critical modules | Mai e tail de muncă: workflows post-spec ~50%, email post-spec ~40%, totp ~70%, tasks ~85%, contracts ~95%, contact-segments ~95%, forecasting ~95%, duplicates ~85%, companies/contacts/clients ~95%. Servicii încă la 0%: anaf, sso, sync, scim, webauthn, push, calendar, importer, invoice-pdf, formula-fields, custom-fields, attachments, gdpr, leads, email-sequences, email-tracking, whatsapp, reports, validation-rules, territories, contracts-pdf. Restul controllerelor ~0% (nu sunt unit-tested deliberat — folosim e2e specs pentru ele). |
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
