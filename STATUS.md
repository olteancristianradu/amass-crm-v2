# STATUS.md — Stadiul Proiectului Amass CRM v2

> Actualizat: 2026-04-19 | Sprint curent: S53–S55 (Leads, Contracte, Forecasting)

---

## Rezumat rapid

| Indicator | Valoare |
|-----------|---------|
| Module backend | 48 |
| Modele Prisma (tabele) | 60+ |
| Pagini frontend | 43 |
| Unit tests API | **32 passing** |
| TypeScript errors | **0** |
| Lint errors | **0** |
| E2e tests | 13 fișiere (necesită Docker cu Postgres + Redis + MinIO) |

---

## ✅ Implementat complet

### Core CRM
- [x] Companies (CRUD, search, soft-delete, ierarhie parent/child, multi-tenant)
- [x] Contacts (legate de companies)
- [x] Clients (B2C, portal acces)
- [x] Deals + Pipeline Kanban (stages, probability, WON/LOST)
- [x] Tasks + Reminders (BullMQ delayed jobs, notificare la scadență)
- [x] Notes + Attachments (MinIO storage, presigned URLs)
- [x] Activity Log + Audit Trail (toate mutațiile înregistrate)

### Vânzări & Revenue
- [x] **Leads** — pipeline prospecți, conversie atomică Lead→Contact+Company+Deal
- [x] Quotes (oferte) cu QuoteLines + aprobare + semnătură portal
- [x] Invoices + InvoiceLines + Payments tracking
- [x] Products + Price Lists + Categories
- [x] Approvals (policy-based, trigger QUOTE_ABOVE_VALUE)
- [x] Lead Scoring (AI-powered, BullMQ async recompute)
- [x] **Forecasting** — pipeline ponderat vs quota per user/perioadă
- [x] **Contracte** — CRUD cu tracking expirare, auto-renewal, stocare PDF MinIO

### Comunicare
- [x] Email (SMTP + tracking deschidere click)
- [x] Email Sequences (automated cadences multi-step)
- [x] Calls (Twilio + transcripție AI Whisper + rezumat Claude)
- [x] WhatsApp (Twilio Business API)
- [x] SMS (Twilio, inbound + outbound)
- [x] Notificări real-time (Socket.IO gateway, JWT auth)

### Integrări & Platform
- [x] Calendar (Google + Outlook sync, CalDAV)
- [x] ANAF e-Factura (facturare electronică RO)
- [x] SSO/SAML (enterprise auth, Okta/Azure AD)
- [x] Webhooks outbound (HMAC-SHA256 signing)
- [x] Stripe Billing (subscriptions, webhooks)
- [x] Multi-tenancy (RLS + TenantGuard + Prisma middleware + Audit)
- [x] RBAC (OWNER, ADMIN, MANAGER, MEMBER, VIEWER)
- [x] GDPR (consent, data export, right to erasure)
- [x] Custom Fields (per entity type, tipuri multiple)
- [x] Contact Segments (filtre dinamice)
- [x] Report Builder (custom reports cu allowlist coloane)
- [x] Data Export (CSV async BullMQ)
- [x] Duplicate Detection
- [x] GestCom Importer (import date din GestCom)
- [x] Client Portal (link acces clienți, semnare oferte)
- [x] AI Enrichment (Claude API enrichment companii)
- [x] Sentry (error monitoring API + Web)
- [x] OpenAPI/Swagger auto-generat

### Frontend (43 pagini)
- [x] Dashboard
- [x] Companies (list + detail), Contacts (list + detail), Clients (list + detail)
- [x] **Leads** (list, creare, conversie)
- [x] Deals Kanban
- [x] **Contracte** (list, creare, tracking expirare)
- [x] **Prognoze Vânzări** (pipeline vs quota)
- [x] Tasks, Reminders
- [x] Invoices, Quotes, Products, Projects
- [x] Calendar
- [x] Email Settings, Phone Settings, WhatsApp Inbox, SMS Inbox
- [x] Reports, Report Builder
- [x] Approvals, Audit Trail
- [x] Custom Fields, Webhooks, Billing
- [x] Contact Segments, Email Sequences
- [x] Exports, Duplicates, Search
- [x] Settings (Users, 2FA)

---

## 🔄 Parțial implementat

- [ ] **Company Timeline UI** — backend există (Activities), UI aggregat lipsă
- [ ] **Dashboard KPIs reale** — pagina există, date din API-uri reale nu sunt connectate
- [ ] **Company subsidiary view** — `parent_id` în DB, UI de vizualizare lipsă

---

## ❌ Lipsă față de Salesforce (prioritizat)

### Prioritate mare
- [ ] **Cazuri Suport (Cases/Tickets)** — ticketing intern, SLA tracking, escalation rules
- [ ] **Campanii Marketing** — grupuri de contacte, tracking conversii, ROI campanie
- [ ] **Subscriptions/MRR** — venituri recurente, churn tracking, ARR dashboard
- [ ] **Comenzi (Orders)** — after quote acceptance → order + fulfillment tracking

### Prioritate medie
- [ ] **Reguli de validare** — logică custom pe câmpuri (ex: "CUI must be 8 digits")
- [ ] **Câmpuri formula** — câmpuri calculate din alte câmpuri
- [ ] **Gantt view** pentru proiecte
- [ ] **Mobile PWA** — app responsivă instalabilă pe telefon
- [ ] **Catalog produse avansat** — bundle-uri, variante, stoc
- [ ] **Comisioane vânzători** — tracking sales rep commissions

### Prioritate mică / Enterprise
- [ ] **Territory Management** — zone geografice/industrie per rep
- [ ] **Marketplace integrări** (AppExchange equivalent)
- [ ] **Chatter intern** — comentarii/feed pe fiecare record
- [ ] **Event Management** — conferințe, webinare

---

## 🔧 Necesită acțiuni manuale (de tine)

Vezi **[MANUAL_STEPS.md](./MANUAL_STEPS.md)** pentru detalii complete.

Rezumat:
1. Cumpără VPS (Hetzner CX31 ~10€/lună) și configurează DNS
2. Completează `.env` cu credențiale reale (Twilio, SendGrid, Stripe, Sentry, ANAF)
3. `docker compose up -d` pe server
4. `pnpm exec prisma migrate deploy` pentru migrările de schema
5. Crează primul tenant via seed script sau API direct
6. Configurează Twilio webhook URLs pentru SMS/WhatsApp/Calls
7. Setează Stripe webhook endpoint în dashboard Stripe

---

## 📁 Structura fișierelor cheie

```
apps/api/src/modules/    — 48 module NestJS
apps/api/prisma/         — schema.prisma + migrări
apps/web/src/routes/     — 43 pagini React
apps/web/src/features/   — 32 API clients frontend
packages/shared/         — Zod schemas comune BE+FE
.github/workflows/ci.yml — CI (lint + typecheck + build + e2e)
```
