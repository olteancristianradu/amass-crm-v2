# AMASS CRM v2

> **CRM multi-tenant B2B/B2C cu inteligență vocală** — transcripție apeluri, diarizare, redactare PII, sumarizare AI.
> Piața țintă: IMM-uri din România și UE.

---

## Cuprins

1. [Stack tehnic](#stack-tehnic)
2. [Arhitectură](#arhitectură)
3. [Funcționalități implementate](#funcționalități-implementate)
4. [Roadmap](#roadmap)
5. [Variabile de mediu](#variabile-de-mediu)
6. [Instalare și pornire](#instalare-și-pornire)
7. [Conturi de test](#conturi-de-test)
8. [Structura proiectului](#structura-proiectului)
9. [Securitate](#securitate)
10. [Contribuție](#contribuție)

---

## Stack tehnic

### Backend

| Tehnologie | Versiune | Utilizare |
|---|---|---|
| **Node.js** | 22 LTS | Runtime server |
| **TypeScript** | 5 strict | Tip-safe pe tot codul |
| **NestJS** | 10 | Framework HTTP (guards, pipes, middleware, BullMQ) |
| **Prisma** | 6 | ORM + migrări + Postgres RLS |
| **PostgreSQL** | 16 + pgvector | Baza de date principală + căutare semantică vectorială |
| **Redis** | 7 | Cache, sesiuni BullMQ, idempotență webhook Twilio |
| **BullMQ** | 5 | Cozi async: email, transcriere, importuri CSV, reminder-uri |
| **MinIO** | RELEASE.2024 | Object storage S3-compatible (înregistrări, fișiere atașate) |
| **Zod** | 3 | Validare scheme partajate FE+BE |
| **Pino** | 9 | Logging structurat JSON |
| **Nodemailer** | 6 | Trimitere email via SMTP |

### Frontend

| Tehnologie | Versiune | Utilizare |
|---|---|---|
| **React** | 19 | UI principal |
| **Vite** | 5 | Build tool + dev server |
| **TanStack Router** | 1 | Routing type-safe cu search params validați |
| **TanStack Query** | 5 | Server state, cache, invalidare automată |
| **shadcn/ui + Tailwind CSS** | 3 | Design system + styling |
| **React Hook Form + Zod** | - | Formulare cu validare tip-safe |
| **Zustand** | 4 | State global (auth) |
| **Socket.IO client** | 4 | Reminder-uri realtime push |

### AI Worker (Python)

| Tehnologie | Versiune | Utilizare |
|---|---|---|
| **Python** | 3.12 | Runtime worker AI |
| **FastAPI** | 0.111 | API HTTP pentru callback-uri din NestJS |
| **Whisper / WhisperX** | - | Transcriere audio + diarizare vorbitori |
| **Presidio** | 2 | Redactare automată PII (nume, CNP, IBAN, telefon) |
| **Anthropic Claude API** | `claude-sonnet-4-6` | Sumarizare apeluri, extragere acțiuni, analiză sentiment |
| **OpenAI Embeddings** | `text-embedding-3-small` | Vectorizare documente pentru căutare semantică |

### Infrastructură

| Tehnologie | Utilizare |
|---|---|
| **Docker Compose** | Orchestrare dev: Postgres, Redis, MinIO, ai-worker, api, web |
| **Caddy** | Reverse proxy HTTPS (producție) |
| **Twilio** | Centrală telefonică: numere virtuale, apeluri outbound/inbound, înregistrări |
| **GitHub Actions** | CI: lint, typecheck, build, teste (Vitest) pe fiecare PR |
| **Turborepo + pnpm** | Monorepo cu build caching |

---

## Arhitectură

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                React 19 + TanStack Router/Query             │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                  CADDY (reverse proxy)                      │
└────────┬───────────────────────────────────┬────────────────┘
         │ /api/v1/*                          │ /ws
┌────────▼────────┐                 ┌─────────▼──────────────┐
│   NestJS API    │                 │   Socket.IO Gateway    │
│  (port 3000)    │                 │  (reminder push, live) │
│                 │                 └────────────────────────┘
│  JwtAuthGuard   │
│  TenantGuard    │◄──── AsyncLocalStorage (tenant context)
│  RolesGuard     │
│  ZodPipes       │
└────┬────┬───────┘
     │    │
     │    └──────── BullMQ ──────► Redis ──► Workers
     │                               │        ├── email.processor.ts
     │                               │        ├── import.processor.ts
     │                               │        ├── reminder.processor.ts
     │                               │        └── ai-calls queue ──► Python AI Worker
     │
┌────▼────┐    ┌──────────┐    ┌────────────┐
│Postgres │    │  Redis   │    │   MinIO    │
│16+RLS   │    │  7 cache │    │ S3 storage │
└─────────┘    └──────────┘    └────────────┘
```

**Izolare multi-tenant (3 straturi):**
1. `TenantContextMiddleware` → citește JWT, populează `AsyncLocalStorage`
2. Prisma extension `tenantExtension()` → injectează automat `tenantId` în toate query-urile
3. PostgreSQL RLS policies → ultimul strat de apărare la nivel DB

---

## Funcționalități implementate

### Gestiune date

| Modul | Funcționalități |
|---|---|
| **Companii** | CRUD complet, CUI/J-number, industrie, dimensiune, **status relație** (Lead/Prospect/Activ/Inactiv), **sursă lead** (Referral/Web/Cold-call/etc.), export CSV, căutare full-text, bulk delete |
| **Contacte** | CRUD, legătură companie (1:many), funcție, telefon/mobil, **flag decident**, export CSV, bulk delete, căutare |
| **Clienți** | CRUD persoane fizice, adresă completă, import CSV (GestCom format) |
| **Segmente contacte** | Builder filtre AND/OR cu preview live, salvare segmente reutilizabile |

### Pipeline vânzări

| Modul | Funcționalități |
|---|---|
| **Leads** | Pipeline prospecți (NEW→CONTACTED→QUALIFIED→CONVERTED), conversie atomică Lead→Contact+Company+Deal, scor, sursă, owner |
| **Pipeline / Deals** | Kanban drag & drop, multiple pipeline-uri, etape configurabile, valoare + monedă, probabilitate (override per deal), ownerId, status WON/LOST + motiv pierdere |
| **Forecasting** | Pipeline ponderat (value × probability), commit (≥70% prob), best case, quota per user per perioadă, tabel per reprezentant |
| **Contracte** | CRUD contracte legate de companii, tracking expirare (alert 30 zile), auto-renewal, stocare PDF MinIO, filtrare status/companie |
| **Comenzi (Orders)** | Quote-to-Cash: comenzi cu line items, auto-numerotare per tenant (UNIQUE constraint), lifecycle DRAFT→CONFIRMED→FULFILLED→CANCELLED cu auto-stamp lifecycle dates, total auto-calculat din linii |
| **Tasks** | Legate de deal SAU de subiect polymorfic, prioritate, scadență, assignee |

### Suport & Marketing

| Modul | Funcționalități |
|---|---|
| **Tichete suport (Cases)** | Auto-numerotate per tenant, prioritate (LOW→URGENT), SLA deadline cu alert depășire, asignare, status lifecycle NEW→OPEN→PENDING→RESOLVED→CLOSED cu auto-stamp `resolvedAt` la tranziție terminală, link Company/Contact |
| **Campanii marketing** | Outreach multi-canal (EMAIL/SMS/WHATSAPP/MIXED), legare opțională de Segment, tracking targetCount/sentCount/conversions/revenue, calcul conversion rate, buget vs venit pentru ROI |

### Comunicare

| Modul | Funcționalități |
|---|---|
| **Email** | Conturi SMTP multiple per user (parola encryptată AES-256-GCM), trimitere asincronă via BullMQ, tracking deschideri (pixel) + clickuri (redirect), status QUEUED/SENT/FAILED |
| **Secvențe email** | Drip campaigns: N pași cu delay în zile, activare/pausare, înrolare contacte, gestionare dezabonare |
| **Apeluri (Twilio)** | Numere virtuale E.164, click-to-call outbound, inbound routing (lookup caller în CRM), înregistrare automată, status webhook cu idempotență Redis |

### AI & Inteligență

| Modul | Funcționalități |
|---|---|
| **Transcriere apeluri** | Python worker cu Whisper (stub activ în dev, real la `WHISPER_MODEL=base`), diarizare vorbitori, segmente cu timestamps |
| **PII Redaction** | Presidio: redactare automată CNP, IBAN, nume, nr. telefon din transcrieri |
| **Sumarizare AI** | Claude `claude-sonnet-4-6`: rezumat apel, extragere acțiuni, analiză sentiment, topici detectate |
| **Căutare semantică** | OpenAI `text-embedding-3-small`: vectorizare companii/contacte/clienți, căutare `nearest neighbor` cu pgvector |

### Documente financiare

| Modul | Funcționalități |
|---|---|
| **Oferte (Quotes)** | Creare oferte cu linii (cantitate, preț, TVA), flux DRAFT→SENT→ACCEPTED/REJECTED/EXPIRED, conversie automată ofertă → factură |
| **Facturi** | Serii multiple, numerotare automată, linii cu TVA, status DRAFT→ISSUED→PAID/OVERDUE/CANCELLED, PDF generat automat, export CSV |
| **Plăți** | Înregistrare plăți parțiale/totale, metode BANK/CARD/CASH/OTHER, reconciliere automată status factură |

### Operațional

| Modul | Funcționalități |
|---|---|
| **Proiecte** | Creat din deal WON, status PLANNED/ACTIVE/ON_HOLD/COMPLETED/CANCELLED, buget, date start/end |
| **Reminder-uri** | Polymorfice (Company/Contact/Client), push realtime Socket.IO, snooze, BullMQ delayed jobs |
| **Note + Timeline** | Log activitate polymorfic pe orice subiect, note text, atașamente cu versioning |
| **Atașamente** | Upload direct la MinIO via presigned PUT, versioning (v1/v2/...), download via presigned GET (15 min) |

### Automatizări

| Modul | Funcționalități |
|---|---|
| **Workflows** | Trigger: DEAL_CREATED/STAGE_CHANGED/CONTACT_CREATED/COMPANY_CREATED, pași: SEND_EMAIL / CREATE_TASK / ADD_NOTE / WAIT_DAYS |
| **Secvențe email** | Drip campaigns cu delay configurabil între pași, gestionare status înrolare |

### Rapoarte

| Modul | Funcționalități |
|---|---|
| **Dashboard** | Selector perioadă (7/30/90 zile, 1 an, custom range), KPIs deals, pipeline pe etape, activitate, email, apeluri |
| **Financiar** | Sume emise/plătite/restante/de-încasat per monedă, trend lunar |
| **Forecast** | Pipeline ponderat cu slider probabilitate ajustabil per deal, total forecast vs. valoare brută |

### Admin & Securitate

| Modul | Funcționalități |
|---|---|
| **Auth** | JWT access (15 min) + refresh token (30 zile), bcrypt hashing, rate limiting (60 req/min, 5 login/min) |
| **2FA (TOTP)** | Google Authenticator / Authy compatibil, activare/dezactivare, QR code setup |
| **RBAC** | 5 roluri: OWNER > ADMIN > MANAGER > AGENT > VIEWER, guards pe fiecare endpoint |
| **Audit log** | Înregistrare acțiuni sensibile (login, create, delete, export) cu IP + user-agent |
| **GDPR** | Export date user (portabilitate), ștergere cont + soft-delete pe toate modelele |
| **Swagger/OpenAPI** | Disponibil la `/api/docs` în mediu non-production |

---

## Roadmap

### Versiunea 2.1 (în lucru)

- [ ] Câmpuri custom (custom fields) per entitate
- [ ] Multiple pipeline-uri pe același tenant
- [ ] Approval workflows (aprovare oferte/contracte)
- [ ] SLA tracking pe deal-uri
- [ ] Import SPV (ANAF) — facturi fiscale

### Versiunea 2.2

- [ ] Integrare email inbound (IMAP) — primire + asociere automată cu subiect CRM
- [ ] Sync Google Calendar / Outlook pentru reminder-uri
- [ ] Mobile app (React Native + API existent)
- [ ] WhatsApp Business API integration
- [ ] Rapoarte exportabile PDF/Excel

### Versiunea 2.3

- [ ] AI predictiv: probabilitate câștigare deal bazată pe istoricul tenantului
- [ ] Chatbot intern (RAG pe baza de cunoștințe + documente companie)
- [ ] OCR facturi intrare + matching automat furnizori
- [ ] E-semnătură documente (DocuSign / semnatură.ro)

### Versiunea 3.0

- [ ] Marketplace integrări (ERP SAP/Saga, contabilitate, eCommerce)
- [ ] Multi-language UI (EN/RO/DE)
- [ ] White-label pentru parteneri
- [ ] SaaS multi-region deployment (Railway / Fly.io)

---

## Variabile de mediu

### Backend (`apps/api/.env`)

```bash
# ── Baza de date ──────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://amass:secret@localhost:5432/amasscrm

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_SECRET=minim-32-caractere-secret-schimba-in-productie
JWT_REFRESH_SECRET=alt-secret-minim-32-caractere-diferit
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30

# ── Encryption (parole SMTP stocate encrypted) ───────────────────────────────
# Genereaza cu: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=64-caractere-hex-obligatoriu

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── MinIO (object storage) ───────────────────────────────────────────────────
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=amass-files

# ── Twilio (centrală telefonică) — https://console.twilio.com ────────────────
# Necesare pentru: apeluri outbound/inbound, înregistrări, webhook-uri
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # TwiML App pentru outbound
PUBLIC_URL=https://your-domain.com                        # URL public pentru webhook-uri Twilio

# ── AI Worker ─────────────────────────────────────────────────────────────────
AI_WORKER_URL=http://localhost:8000
AI_WORKER_SECRET=secret-partajat-intre-api-si-worker

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development
```

### AI Worker (`apps/ai-worker/.env`)

```bash
# ── Anthropic Claude (sumarizare, extragere acțiuni) ─────────────────────────
# Obține de la: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx

# ── OpenAI (embeddings pentru căutare semantică) ──────────────────────────────
# Obții de la: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# ── Whisper (transcriere audio) ───────────────────────────────────────────────
# "off" = stub (dev fără GPU)
# "base" / "small" / "medium" / "large" = model real (necesită GPU sau OpenAI Whisper API)
WHISPER_MODEL=off

# ── Securitate ────────────────────────────────────────────────────────────────
AI_WORKER_SECRET=secret-identic-cu-cel-din-api
```

---

## Instalare și pornire

### Cerințe

- **Docker** + **Docker Compose** v2+
- **Node.js** 22 LTS + **pnpm** 9.12+
- **Python** 3.12 (doar pentru AI worker)

### Pas 1 — Clonare și instalare dependențe

```bash
git clone https://github.com/olteancristianradu/amass-crm-v2.git
cd amass-crm-v2
pnpm install
```

### Pas 2 — Configurare variabile de mediu

```bash
cp apps/api/.env.example apps/api/.env
# Editează apps/api/.env cu valorile tale

cp apps/ai-worker/.env.example apps/ai-worker/.env
# Editează apps/ai-worker/.env cu cheile API
```

### Pas 3 — Pornire infrastructură (Docker)

```bash
docker compose up -d postgres redis minio
```

### Pas 4 — Migrare baza de date + seed

```bash
cd apps/api
npx prisma migrate deploy    # aplică toate migrările
npx prisma db seed           # crează conturile de test
```

### Pas 5 — Pornire aplicație

```bash
# Din rădăcina monorepo-ului:
pnpm dev
# → API pe http://localhost:3000
# → Frontend pe http://localhost:5173
# → Swagger pe http://localhost:3000/api/docs
```

### Producție

```bash
pnpm build           # compilare toate pachetele
docker compose up    # pornire completă cu Caddy HTTPS
```

---

## Conturi de test

După rularea `prisma db seed`:

| Rol | Email | Parolă | Permisiuni |
|---|---|---|---|
| **OWNER** | `admin@amass-demo.ro` | `AmassCRM2026!` | Acces total: setări, utilizatori, audit, delete |
| **AGENT** | `agent@amass-demo.ro` | `AmassCRM2026!` | CRM operațional: create/edit companii, contacte, deals, facturi |

> **Atenție:** Schimbă parolele înainte de deployment în producție!

---

## Structura proiectului

```
amass-crm-v2/
├── apps/
│   ├── api/                    # Backend NestJS
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Schema baza de date + migrări
│   │   │   └── seed.ts         # Date inițiale + conturi test
│   │   └── src/
│   │       ├── modules/        # Feature modules (companies, contacts, deals, ...)
│   │       ├── infra/          # Prisma, Redis, Queue, Storage, Metrics
│   │       └── common/         # Guards, pipes, filters, decorators
│   ├── web/                    # Frontend React
│   │   └── src/
│   │       ├── routes/         # Pagini (TanStack Router)
│   │       ├── features/       # API calls + logică per feature
│   │       ├── components/     # Componente reutilizabile
│   │       └── stores/         # Zustand stores
│   └── ai-worker/              # Python FastAPI worker
│       └── app/
│           ├── transcription.py  # Whisper integration
│           ├── redaction.py      # Presidio PII redaction
│           ├── summary.py        # Claude AI summarization
│           └── pipeline.py       # Orchestrator
├── packages/
│   └── shared/                 # Scheme Zod partajate FE+BE
│       └── src/schemas/        # company, contact, deal, invoice, quote, ...
├── docker-compose.yml
├── CLAUDE.md                   # Reguli pentru Claude Code AI assistant
└── LESSONS.md                  # Lecții învățate și greșeli corectate
```

---

## Securitate

- **Multi-tenancy** — 3 straturi: Middleware → Prisma extension → PostgreSQL RLS
- **JWT** — access token 15 min + refresh 30 zile, rotație la refresh
- **Parole** — bcrypt rounds=10, niciodată stocate plain
- **SMTP passwords** — AES-256-GCM encrypted at rest cu `ENCRYPTION_KEY`
- **Rate limiting** — 60 req/min global, 5 req/min pe login
- **Helmet** — HSTS, CSP strict, X-Frame-Options, Referrer-Policy
- **Twilio webhooks** — verificare semnătură HMAC-SHA1 + idempotență Redis
- **2FA TOTP** — compatibil Google Authenticator, OTPlib, activare opțională per user
- **Audit log** — toate acțiunile sensibile loggate cu IP + user-agent + actorId
- **Input validation** — Zod pe toate endpoint-urile, nicio acceptare de `any`
- **SQL injection** — imposibil: Prisma ORM parametrizat + raw queries cu tagged template literals

### Raportare vulnerabilități

Trimite un email la **raduoltean@amass.ro** (sau deschide un Issue privat pe GitHub).

---

## Contribuție

Proiect solo-developer. Pull request-urile sunt binevenite pentru:
- Bugfix-uri documentate cu test
- Traduceri (i18n)
- Documentație

Citește [CLAUDE.md](./CLAUDE.md) pentru regulile de development și [LESSONS.md](./LESSONS.md) pentru istoricul deciziilor tehnice.

---

*AMASS CRM v2 — © 2026 Cristian Radu Oltean. Licență comercială.*
