# FEATURES.md — Catalog complet al funcțiilor AMASS CRM v2

> Ghid în română pentru toate funcțiile CRM-ului. Document de referință pentru
> onboarding, vânzare și training. Pentru detalii tehnice vezi `README.md`.
> Pentru manualul utilizatorului final vezi `README-CEO.md`.

**Versiune:** Tier B+C + post-audit remediation · **Module backend:** 64 (59 funcționale + 5 scaffolds 501) · **Pagini frontend:** ~45–49 (54 `.tsx` în `routes/`, 5 sunt lazy wrappers)
**Stack:** NestJS 11 + Prisma 6 + Postgres 16 + React 19 + TanStack · **Multi-tenant defense-in-depth:** JWT + `RolesGuard` + `TenantContextMiddleware` (ALS) → `tenantExtension` aplicat prin Prisma `$extends` → Postgres RLS (`SET LOCAL app.tenant_id`)

---

## Cuprins

1. [Arhitectura pe categorii](#1-arhitectura-pe-categorii)
2. [Core CRM — entitățile fundamentale](#2-core-crm)
3. [Vânzări și Revenue](#3-vanzari-si-revenue)
4. [Comunicare multi-canal](#4-comunicare-multi-canal)
5. [Suport și SLA](#5-suport-si-sla)
6. [Marketing și automatizări](#6-marketing-si-automatizari)
7. [Management organizațional](#7-management-organizational)
8. [Platformă și integrări](#8-platforma-si-integrari)
9. [AI și analiză](#9-ai-si-analiza)
10. [Setări și administrare](#10-setari-si-administrare)
11. [Funcții NEIMPLEMENTATE — explicații detaliate](#11-functii-neimplementate)
12. [Fluxuri de conexiune între module](#12-fluxuri-de-conexiune)
13. [Glosar termeni tehnici](#13-glosar)

---

## 1. Arhitectura pe categorii

| Categorie | Module | Pagini FE | Rol |
|-----------|--------|-----------|-----|
| Core CRM | 8 | 7 | Companii, contacte, clienți, leads, note, atașamente, audit, activity log |
| Vânzări | 10 | 10 | Pipeline, deals, oferte, comenzi, facturi, plăți, forecasting, contracte, comisioane, produse |
| Comunicare | 6 | 5 | Email, apeluri, WhatsApp, SMS, secvențe, notificări real-time |
| Suport | 2 | 1 | Cazuri/tichete, SLA escalation |
| Marketing | 4 | 4 | Campanii, segmente contacte, evenimente, lead scoring |
| Organizare | 6 | 6 | Proiecte, tasks, reminders, teritorii, chatter, aprobări |
| Platformă | 8 | 6 | Calendar, ANAF, SSO, webhooks, billing, portal, GDPR, import |
| AI | 2 | – | Enrichment companii, rezumate apeluri (Claude + Whisper) |
| Admin | 10 | 7 | Auth, users, RBAC, 2FA, custom fields, validation rules, formula fields, duplicates, exports, audit |
| Variante+Bundle | 2 | – | Product variants (SKU+stoc), product bundles |
| Abonamente | 1 | 1 | MRR/ARR tracking subscriptions |
| **Total funcționale** | **59** | **~45–49** | (plus 5 module scaffold 501: SCIM, WebAuthn, Sync, Push, AccessControl) |

---

## 2. Core CRM

### 2.1 Companies (Companii)
- **Ce face:** CRUD companii B2B cu ierarhie parent/child (holding → subsidiare), industrie, CUI, adresă, ownership, soft-delete.
- **De ce contează:** Entitatea-rădăcină pentru toate B2B. Orice contact/deal/factură se leagă de o companie.
- **UI:** `/app/companies` (list) + `/app/companies/$id` (detail cu tabs: Overview, Contacte, Deals, Note, Atașamente, Cronologie, Subsidiare)
- **API:** `GET|POST /api/v1/companies`, `GET|PATCH|DELETE /companies/:id`, `GET /companies/:id/subsidiaries`
- **DB:** `companies` (parentId self-ref), index pe tenantId + search tsvector
- **Conexiuni:** → Contacts, Deals, Invoices, Contracts, Cases, Chatter, Attachments, Notes

### 2.2 Contacts (Contacte)
- **Ce face:** Persoane fizice asociate companiilor B2B (decision-makers, influențatori). Nume, email, telefon, poziție, LinkedIn.
- **De ce contează:** Nucleul comunicării. Emailurile și apelurile sunt mereu cu un contact.
- **UI:** `/app/contacts` + `/app/contacts/$id`
- **API:** `/api/v1/contacts` (CRUD + `?companyId=` filter)
- **DB:** `contacts` FK la companies
- **Conexiuni:** → Companies, Deals, Emails, Calls, Campaigns, Segments

### 2.3 Clients (Clienți B2C)
- **Ce face:** Persoane fizice fără companie asociată — pentru business-uri B2C (retail, servicii personale).
- **UI:** `/app/clients` + `/app/clients/$id`
- **API:** `/api/v1/clients`
- **Conexiuni:** → Portal (acces semnare oferte), Invoices, Cases

### 2.4 Leads
- **Ce face:** Pipeline prospecți NEcalificați (înainte să devină Contact+Company). Sursă, status (NEW→CONTACTED→QUALIFIED→CONVERTED), scoring AI automat.
- **Conversie atomică:** `POST /leads/:id/convert` creează simultan Contact + Company + Deal în tranzacție Prisma.
- **UI:** `/app/leads` (tabel cu scoring badge)
- **DB:** `leads` (AI score recomputat async BullMQ)

### 2.5 Notes (Note)
- **Ce face:** Note text polimorfice pe Company/Contact/Client/Deal (`subjectType`, `subjectId`).
- **UI:** tab "Note" pe fiecare detail
- **API:** `/api/v1/notes?subjectType=COMPANY&subjectId=...`

### 2.6 Attachments (Atașamente)
- **Ce face:** Fișiere stocate MinIO (S3-compatible), metadata în Postgres. Upload presigned PUT (FE → MinIO direct), download presigned GET 15min expiry.
- **Limita:** 50MB/fișier (configurabil)
- **DB:** stochează doar `storageKey` + `contentType` + `size` — binarul e în MinIO
- **Regulă CLAUDE.md:** binare NU în Postgres, niciodată.

### 2.7 Activities (Activity Log)
- **Ce face:** Log cronologic per entitate — cine a făcut ce și când (email trimis, apel primit, note adăugată, status schimbat).
- **UI:** tab "Cronologie" pe Company Detail
- **Diferență față de Audit:** Activity = business events vizibile userului; Audit = toate operațiile CRUD la nivel de DB.

### 2.8 Audit (Jurnal audit)
- **Ce face:** Log imuabil al tuturor mutațiilor DB (CREATE/UPDATE/DELETE) + cine, ce tenant, când, snapshot before/after.
- **De ce contează:** Conformitate GDPR, forensics, debugging.
- **UI:** `/app/audit` (doar OWNER/ADMIN)
- **Implementare:** `AuditService.log()` este apelat explicit din fiecare service care mutează date; scrie în `audit_logs` prin `runWithTenant` (Layer 2 tenantExtension + Layer 3 RLS). SIEM webhook forwarding opțional (breaker-protected). Retention cron configurabil per tenant.

---

## 3. Vânzări și Revenue

### 3.1 Pipelines + Deals (Pipeline vânzări)
- **Ce face:** Pipeline-uri multi-stage (NEW → QUALIFIED → PROPOSAL → NEGOTIATION → WON/LOST). Fiecare tenant poate avea mai multe pipeline-uri (ex: Enterprise, SMB).
- **Deals:** oportunități concrete cu valoare, probabilitate, owner, data estimată închidere.
- **UI:** `/app/deals` — Kanban drag-and-drop între coloane (stages)
- **API:** `/api/v1/pipelines`, `/api/v1/deals`
- **Conexiuni:** Deal WON → trigger Commission + Project + Invoice

### 3.2 Forecasting (Prognoze)
- **Ce face:** Pipeline ponderat (suma deals × probability per stage) vs cota per user/echipa/perioadă. KPI quota attainment.
- **UI:** `/app/forecasting` (tabel cu bare progres)
- **API:** `GET /api/v1/forecasting?period=Q2&userId=...`

### 3.3 Contracts (Contracte)
- **Ce face:** Stocare contracte semnate (PDF MinIO) cu dată start/end, auto-renewal flag, valoare, status.
- **Alertă expirare:** BullMQ job zilnic → email owner dacă `endDate < now + 30 zile`.
- **UI:** `/app/contracts`

### 3.4 Quotes (Oferte)
- **Ce face:** Oferte cu line items (produse/servicii, cantitate, preț, discount), calcul TVA, aprobare (workflow), semnătură via portal.
- **Status:** DRAFT → SENT → ACCEPTED/REJECTED → CONVERTED_TO_ORDER
- **Trigger Approvals:** dacă valoare > threshold, redirect spre aprobare manager.

### 3.5 Orders (Comenzi)
- **Ce face:** Comenzi ferme după oferta acceptată. Lifecycle DRAFT → CONFIRMED → FULFILLED → INVOICED. Line items, adresă livrare.
- **UI:** `/app/orders`
- **Flux:** Quote ACCEPTED → Order → Invoice → Payment

### 3.6 Invoices (Facturi) + Payments (Plăți)
- **Ce face:** Facturi cu linii, TVA, scadență, plăți parțiale tracking. Integrare ANAF e-Factura pentru emitere electronică RO.
- **Status:** DRAFT → ISSUED → PARTIALLY_PAID → PAID → OVERDUE
- **Payment:** una sau multiple per factură, metodă (transfer/card/cash), data, suma.

### 3.7 Products
- **Ce face:** Catalog produse/servicii cu preț, categorie, TVA. Folosit în Quotes/Orders/Invoices linii.
- **UI:** `/app/products`

### 3.8 Product Variants
- **Ce face:** Variante SKU (mărime/culoare) cu stoc per variantă. Endpoint `POST /products/:id/variants/:variantId/adjust-stock` pentru ajustare.
- **DB:** `product_variants` (productId, sku unique, stockQty)

### 3.9 Product Bundles
- **Ce face:** Pachete cu mai multe produse (ex: "Starter Pack" = laptop + geantă + mouse), preț combinat (sau discount).
- **DB:** `product_bundles` + `product_bundle_items` (bundleId → productId × qty)

### 3.10 Commissions (Comisioane)
- **Ce face:** Planuri comision per user (% din WON deals) + calcul lunar automat. Dashboard agent: comisioane neîncasate, plătite, total YTD.
- **Compute:** `POST /commissions/compute?month=2026-04` walk WON deals × plan.percent, upsert idempotent.
- **UI:** `/app/commissions` (tabel per agent + mark-paid)

### 3.11 Subscriptions / MRR
- **Ce face:** Tracking abonamente clienți (SaaS-style). Model `CustomerSubscription` (planId, MRR, startDate, cancelDate).
- **Metrici:** MRR total, ARR, churn rate lunar, snapshot per plan.
- **UI:** `/app/subscriptions` dashboard MRR
- **Diferență față de Billing:** Subscriptions = clienții TĂI (revenue); Billing = abonamentul TĂU la Stripe (costul SaaS-ului).

---

## 4. Comunicare multi-canal

### 4.1 Email
- **Ce face:** SMTP outbound (SendGrid sau server propriu), tracking deschideri (pixel transparent) și click-uri (URL redirect).
- **UI:** `/app/email-settings` (config SMTP), compose din contact detail
- **DB:** `emails` + `email_tracking_events`

### 4.2 Email Sequences (Secvențe)
- **Ce face:** Cadențe multi-pas automate ("Ziua 0: intro → Ziua 3: follow-up → Ziua 7: close"). Pauze condiționate de răspuns (dacă contactul răspunde, secvența se oprește).
- **UI:** `/app/email-sequences`
- **Engine:** BullMQ delayed jobs per step.

### 4.3 Calls (Apeluri)
- **Ce face:** Integrare Twilio Voice — click-to-call, inbound calls cu screen-pop, înregistrare audio, transcripție automată (Whisper), rezumat AI (Claude sonnet-4-6), diarization (cine vorbește când), redactare PII (Presidio).
- **UI:** `/app/phone-settings` (config Twilio), widget call din contact detail
- **AI worker:** FastAPI Python 3.12 separat care procesează audio async.

### 4.4 WhatsApp
- **Ce face:** Twilio WhatsApp Business API — inbound/outbound messages, templates aprobate (pentru outreach), inbox per agent.
- **UI:** `/app/whatsapp` (conversații threaded)

### 4.5 SMS
- **Ce face:** Twilio SMS pentru notificări tranzacționale (OTP, reminder plată) + campanii marketing.
- **UI:** `/app/sms`

### 4.6 Notifications (Notificări real-time)
- **Ce face:** Socket.IO gateway cu JWT auth. Push notificări instant: reminders scadente, @mentions în Chatter, approvals pending, escalation SLA, comisioane calculate.
- **UI:** bell icon în AppShell (badge unread count)
- **Tipuri:** SYSTEM, REMINDER, MENTION, APPROVAL, SLA_BREACH

---

## 5. Suport și SLA

### 5.1 Cases / Tichete suport
- **Ce face:** Tichete cu prioritate (LOW/NORMAL/HIGH/URGENT), status (OPEN→IN_PROGRESS→WAITING→RESOLVED→CLOSED), SLA deadline bazat pe prioritate, asignare agent, auto-numerotare per tenant (#CASE-1, #CASE-2…).
- **UI:** `/app/cases` (tabel cu KPI "SLA depășit")
- **API:** `/api/v1/cases` (CRUD + status transitions)

### 5.2 SLA Escalation
- **Ce face:** Cron `*/15 * * * *` scanează cazuri OPEN cu `slaDeadline < now` → auto-bump prioritate NORMAL→HIGH→URGENT. La URGENT + notificare owner echipă.
- **Implementare:** `SchedulerModule` + raw SQL cu cast `"CasePriority"` enum.

---

## 6. Marketing și automatizări

### 6.1 Campaigns (Campanii marketing)
- **Ce face:** Outreach multi-canal (email/SMS/WhatsApp) către segmente de contacte. Tracking conversii, ROI, buget alocat vs cheltuit.
- **UI:** `/app/campaigns`
- **Limitare actuală:** send manual (nu se declanșează automat din Workflow — vezi secțiunea 11).

### 6.2 Contact Segments (Segmente)
- **Ce face:** Filtre dinamice salvate (ex: "Contacte IT din București cu deal WON > 10k în ultimele 90 zile"). Re-evaluate la fiecare folosire.
- **UI:** `/app/contact-segments`

### 6.3 Events (Evenimente)
- **Ce face:** Conferințe/webinare/workshop-uri cu dată, locație, capacitate. Invitați + tracking prezență (INVITED → REGISTERED → ATTENDED → NO_SHOW).
- **UI:** `/app/events`
- **Integrare:** Attendees din segmente, emitere factură după eveniment.

### 6.4 Lead Scoring
- **Ce face:** Scor 0-100 per Lead calculat AI (Claude) pe baza: industrie, sursă, interacțiuni (emailuri deschise, clickuri), profil BANT.
- **Trigger:** BullMQ async la modificare Lead.
- **Folos:** prioritizare agenți — sună întâi lead-urile cu scor ≥ 80.

---

## 7. Management organizațional

### 7.1 Projects (Proiecte)
- **Ce face:** Proiecte de implementare (ex: "Implementare ERP pentru Client X"), tasks legate, dată start/end, status, assignee.
- **UI:** `/app/projects` + `/app/projects/$id`
- **Trigger:** Deal WON → creare Project automată (opțional).
- **Lipsă:** vizualizare Gantt (vezi secțiunea 11).

### 7.2 Tasks
- **Ce face:** Task-uri cu scadență, prioritate, status (TODO→IN_PROGRESS→DONE), assignee, legătură la subject polimorfic (Company/Deal/Project).
- **UI:** `/app/tasks` (tab "Ale mele" vs "Toate")

### 7.3 Reminders
- **Ce face:** Alerte programate (ex: "Sună pe X la 14:00 mâine"). BullMQ delayed job → notificare Socket.IO + email la scadență.
- **UI:** `/app/reminders`

### 7.4 Territories (Teritorii)
- **Ce face:** Zone geografice/industriale (ex: "București IT", "Cluj Retail") cu asignare agenți. Folosit pentru routing leads + rapoarte regionale.
- **UI:** `/app/territories`
- **DB:** `territories` (counties[], industries[]) + `territory_assignments` (userId)

### 7.5 Chatter (feed intern)
- **Ce face:** Feed social intern polimorfic — postează comentarii, updates, întrebări pe orice subiect (Deal, Company, Project). `@mentions` trimit notificări automate.
- **UI:** tab "Chatter" pe orice detail page
- **Inspirat din:** Salesforce Chatter

### 7.6 Approvals (Aprobări)
- **Ce face:** Policy-based approval — trigger pe criterii (ex: `QUOTE_ABOVE_VALUE: 50000`), redirect cerere spre manager. Status PENDING→APPROVED/REJECTED + audit trail.
- **UI:** `/app/approvals`

---

## 8. Platformă și integrări

### 8.1 Calendar
- **Ce face:** Sync 2-way cu Google Calendar + Outlook + CalDAV. Meetings-urile create în CRM apar în calendar personal și invers.
- **UI:** `/app/calendar` (view lună/săptămână/zi)

### 8.2 ANAF e-Factura
- **Ce face:** Emitere facturi electronice conforme RO către ANAF (API oficial). Semnătură digitală XML, tracking status (`SENT → VALIDATED → ACCEPTED`).
- **Obligatoriu RO:** din iulie 2024 pentru toate B2B.
- **UI:** `/app/invoices` — sub fiecare factură non-DRAFT vezi
  panoul ANAF cu badge status (`Trimisă` / `În validare` /
  `Validată` / `Respinsă`) + buton **Trimite la ANAF** + link
  **XML** (descarcă UBL 2.1).

#### De ce există butonul "Descarcă XML" și ce vezi în el

Când dai click pe **XML** lângă badge-ul ANAF, se deschide într-un
tab nou structura raw a facturii în format **UBL 2.1 / CIUS-RO 1.0.1**
— exact bytii pe care i-am trimis la ANAF. Nu are stylesheet, deci
browserul afișează tree-ul XML aproape ca pe HTML "gol cu cod".
**Asta e normal și intenționat** — XML-ul e mașină-citibil, nu
proiectat pentru ochi umani.

La ce te ajută concret:

1. **Conformitate fiscală** — Ministerul Finanțelor (ANAF) impune
   formatul UBL 2.1 customization românesc CIUS-RO. XML-ul trebuie
   păstrat 5+ ani ca dovadă fiscală în caz de control.
2. **Audit trail** — contabilul tău confirmă vizual exact ce date
   au plecat la ANAF (sumele, TVA, supplier, client, line items).
   Dacă apare o discrepanță în declarația fiscală, XML-ul e
   dovada juridică a ce a fost transmis.
3. **Re-submission după respingere** — dacă ANAF respinge factura
   (CIF inactiv, sume nepotrivite, format greșit), iei XML-ul,
   identifici câmpul greșit, corectezi datele în CRM, regenerezi
   și retrimiți. XML-ul îți spune *exact ce a primit ANAF*, nu
   ce credea CRM-ul tău că a trimis.
4. **Debug ANAF** — când ANAF îți spune "factura X e respinsă cu
   eroare Y", te uiți în XML să vezi ce câmp e problematic
   (un VAT lipsă, un cod CPV invalid, etc.).
5. **Portabilitate** — dacă vreodată schimbi CRM-ul, XML-urile
   exportate sunt standard UBL 2.1, deci orice alt sistem
   conform poate să le re-importe sau să le folosească ca
   referință.

**Pentru utilizatorul tău (clientul facturat) NU există XML-ul.**
El primește factura PDF "frumoasă" — endpoint separat
`GET /invoices/:id/pdf-url` (vizibil ca buton **Descarcă PDF**
pe pagina de detaliu), generat din același set de date dar
cu layout pentru oameni. XML-ul e doar pentru tine + ANAF +
contabil + auditor fiscal.

**Lifecycle complet** vizibil în badge:
- `Neprezentată` (gri) — invoice creată, încă nu submit-uită la ANAF
- `Trimisă` (albastru) — POST la `/upload`, am primit `index_incarcare`
- `În validare` (albastru) — ANAF procesează, polling `/stareMesaj`
- `Validată` (verde) — `stare=ok`, am primit `id_descarcare`
- `Respinsă` (roz) — `stare=nok`, primul mesaj de eroare apare inline
- `Eroare locală` (roz) — circuit-breaker / network / OAuth fail

### 8.3 SSO / SAML
- **Ce face:** Single Sign-On enterprise — integrare Okta, Azure AD, Google Workspace. User-ul se loghează cu contul de companie, fără parole separate.

### 8.4 Webhooks (outbound)
- **Ce face:** Trimite evenimente CRM spre sisteme externe (ex: Zapier, n8n, ERP-ul clientului). Semnate HMAC-SHA256 cu secret per webhook. Retry cu exponential backoff la failure.
- **Evenimente:** `deal.won`, `invoice.paid`, `case.escalated`, `contact.created` etc.
- **UI:** `/app/settings/webhooks`

### 8.5 Billing (Stripe)
- **Ce face:** Abonamentul TĂU (companie) la planul SaaS AMASS-CRM — plăți prin Stripe, webhooks pentru renewal/churn.
- **UI:** `/app/settings/billing`

### 8.6 Portal (Client Portal)
- **Ce face:** Link public securizat (token expirabil) pentru clienți să vadă oferte, să semneze digital, să descarce facturi, să deschidă tichete suport.
- **UI:** `/portal/:token` (fără login)

### 8.7 GDPR
- **Ce face:** Consent tracking per contact, export date personale (right to access), ștergere (right to erasure — anonymize NOT delete, pentru audit).
- **API:** `POST /gdpr/export?contactId=…`, `POST /gdpr/erase`

### 8.8 Importer (GestCom + CSV)
- **Ce face:** Import date din GestCom (sistem ERP popular în RO) + import CSV generic. Preview → validation → commit cu dry-run.
- **UI:** pagină importer (pending implementare FE vizuală)

---

## 9. AI și analiză

### 9.1 AI Enrichment
- **Ce face:** Claude (sonnet-4-6) analizează datele existente despre o companie → sugerează industrie, mărime, topicuri cheie, health score relație, next best action. Non-destructiv (sugestii, nu auto-apply).
- **Fallback:** Google Gemini dacă ANTHROPIC_API_KEY lipsește.
- **Timeout config:** 90s, 2 retries (`enrichment.service.ts`)

### 9.2 Deal AI
- **Ce face:** Analiză deal-uri stagnante, sugestii next step, predicție probabilitate WON bazat pe istoric.

### 9.3 Reports (Rapoarte predefinite)
- **Ce face:** Dashboard cu KPI-uri standard: pipeline total, deals WON/LOST, MRR trend, conversion funnel, activity per user.
- **UI:** `/app/reports`

### 9.4 Report Builder (Rapoarte custom)
- **Ce face:** Builder drag-and-drop pentru rapoarte ad-hoc — alegi entitatea, coloanele (allowlist de securitate), filtrele, groupBy, export CSV.
- **UI:** `/app/report-builder`

---

## 10. Setări și administrare

### 10.1 Auth
- **Ce face:** JWT access token (15min) + refresh token (30 zile) + session tracking DB. Logout invalidează refresh. Login rate-limited (5/min/IP).

### 10.2 Users (Utilizatori)
- **Ce face:** CRUD useri din tenant, invite via email, resetare parolă, dezactivare (păstrează istoric).
- **UI:** `/app/settings/users` (OWNER/ADMIN)

### 10.3 RBAC (roluri)
- **Roluri:** OWNER (full), ADMIN (no billing/delete tenant), MANAGER (echipa lui), AGENT (datele lui), VIEWER (read-only)
- **Check:** `@Roles(UserRole.ADMIN)` decorator + RolesGuard pe controllers

### 10.4 2FA (TOTP)
- **Ce face:** Google Authenticator / Authy — secret criptat cu ENCRYPTION_KEY în DB, verificat la login după parolă.
- **UI:** `/app/settings/2fa`

### 10.5 Custom Fields
- **Ce face:** Câmpuri adiționale per entitate (ex: "Cod SAP" pe Company, "Preferință ambalaj" pe Contact). Tipuri: TEXT, NUMBER, DATE, BOOLEAN, SELECT, MULTI_SELECT.
- **UI:** `/app/settings/custom-fields`

### 10.6 Validation Rules
- **Ce face:** Reguli care blochează salvarea dacă un câmp nu respectă condițiile. Tipuri: REGEX, MIN_LENGTH, MAX_LENGTH, EQUALS, NOT_EQUALS.
- **Exemplu:** `Contact.email` trebuie să match regex email valid.

### 10.7 Formula Fields
- **Ce face:** Câmpuri calculate dinamic (ex: `full_name = CONCAT(firstName, " ", lastName)`). Parser sandboxat fără `eval`: suportă `+/-/*//`, `CONCAT`, `IF`, `UPPER`, `LOWER`, `LEN`.
- **Limitare cunoscută:** precedință nu e completă pentru paranteze imbricate complex (caz rar, dar există).

### 10.8 Duplicates
- **Ce face:** Detectare duplicate (fuzzy match pe nume/email/telefon via `pg_trgm`) + merge tool.
- **UI:** `/app/duplicates`

### 10.9 Exports
- **Ce face:** Export async (BullMQ job) în CSV pentru orice entitate. Email cu link download când e gata.
- **UI:** `/app/exports`

### 10.10 Notifications (Settings)
- **Ce face:** Preferințe per user — ce notificări vrei (email/push/in-app) pentru fiecare tip event.

---

## 11. Funcții NEIMPLEMENTATE

Cele 3 funcții rămase pe lista "nice-to-have" și ce ar implica fiecare:

### 11.1 Gantt view Proiecte

**Ce înseamnă:** Diagramă vizuală orizontală unde fiecare task din proiect apare ca o bară colorată pe o axă de timp. Vezi simultan durata, dependențele, suprapunerile, drumul critic.

**La ce folosește:**
- PM-ul vede dintr-o privire dacă proiectul e în întârziere
- Drag la capătul barei = extinzi deadline-ul
- Săgeți între task-uri = dependențe (ex: "design" trebuie terminat înainte de "development")
- Zoom in/out: zi, săptămână, lună, trimestru

**Ce e nevoie să implementezi:**
1. Bibliotecă frontend: `gantt-task-react` (~80kB gzipped) sau `@dhx/trial-gantt` (enterprise, plătit)
2. Endpoint nou: `GET /api/v1/projects/:id/gantt-data` → format `{tasks:[{id,name,start,end,progress,dependencies}]}`
3. Pagină nouă: `/app/projects/$id/gantt`
4. Model DB extins: `task_dependencies` (predecessorId, successorId, type: FS/SS/FF/SF)
5. Drag handlers → PATCH task pentru update dates
6. Critical path algorithm (opțional, calcul în backend)

**Efort estimat:** 3-5 zile de lucru pentru versiune funcțională.

### 11.2 Marketplace integrări (AppExchange equivalent)

**Ce înseamnă:** Magazin de integrări terțe pe care clienții le pot instala cu un click — ca AppExchange la Salesforce sau App Marketplace la HubSpot. Developeri externi publică aplicații care extind CRM-ul.

**Exemple de integrări ce ar apărea:**
- "Slack Notifier" — postează în canal Slack la deal.won
- "QuickBooks Sync" — sincronizează facturi
- "LinkedIn Scraper" — enrich contacte din profil LinkedIn
- "SMS Blast Pro" — campanii SMS cu templates premium

**Ce e nevoie să implementezi (masiv efort):**
1. **Sistem plugin runtime:** sandbox V8/Deno să ruleze cod terț fără să compromită CRM-ul
2. **API SDK public:** documentat, versionat semantic (v1, v2), rate-limited per app
3. **Registru apps:** DB cu metadata (nume, autor, version, permissions requested, pricing)
4. **OAuth per app:** fiecare integrare cere permisiuni specifice (ex: "read contacts, write notes")
5. **Billing pentru apps plătite:** revenue share cu publisher (70/30)
6. **UI store:** listing, rating, reviews, search, install button
7. **Ecosistem developer:** docs, SDK npm, exemple, programe early access

**Efort estimat:** 3-6 luni full-time. **NU recomandat pentru MVP solo** — doar după product-market fit și 100+ clienți.

### 11.3 Campaign Automation Trigger (Workflow → Campaign)

**Ce înseamnă:** Astăzi, Workflows pot trimite email individual, crea task, adăuga notă. Dar NU pot declanșa automat o Campanie întreagă de marketing (email mass cu segment + template).

**Caz de folosire ce ar fi posibil:**
- Trigger: "Contact nou creat în segment 'VIP Prospects'"
- Action: "Declanșează Campania 'VIP Welcome Series' pentru acest contact"

**Ce e nevoie să implementezi (efort mic, 1-2 zile):**
1. Action nou în Workflows engine: `SEND_CAMPAIGN` cu `campaignId` parametru
2. Service method: `campaigns.service.ts.enrollContact(campaignId, contactId)` — adaugă contactul în audience-ul campaniei + push primul email
3. Validare: contact să fie în segmentul campaniei
4. Audit entry: `workflow_triggered_campaign`
5. UI: dropdown action în workflow builder

**De ce nu e gata:** a fost considerat "nice-to-have" față de fluxurile core (Deal→Commission, Lead→Convert).

---

## 12. Fluxuri de conexiune între module

### 12.1 Lead → Customer (conversie)
```
Lead (prospect) → POST /leads/:id/convert →
  TRANZACȚIE: creează Contact + Company + Deal (stage NEW)
  Lead.status = CONVERTED
  Activity log: LEAD_CONVERTED
  Activity pe Contact: CREATED_FROM_LEAD
```

### 12.2 Deal WON → Revenue flow
```
Deal.stage = WON →
  ├─ trigger Workflow (if any) → creează Project / Task / Chatter post
  ├─ trigger Commission compute (la sfârșit de lună automat)
  ├─ UI sugerează: "Creează Order?" (opțional)
  └─ Forecasting: exclude deal-ul din pipeline, include în "actual"
```

### 12.3 Quote → Order → Invoice → Payment
```
Quote (DRAFT) → aprobare (dacă > threshold) → SENT → 
  client semnează în Portal → ACCEPTED →
  GENERATE Order (CONFIRMED) →
  stocare/livrare → FULFILLED →
  GENERATE Invoice (ISSUED) → ANAF e-Factura submit →
  Payment parțiale/integrale → PAID
```

### 12.4 Case (tichet) → Escalation
```
Case.priority = NORMAL, slaDeadline = now + 24h →
  cron la fiecare 15 min verifică slaDeadline <
  now →
  bump NORMAL → HIGH → URGENT →
  Notification spre owner echipă + manager
```

### 12.5 Chatter @mention → Notification
```
User postează cu @userId în Chatter →
  ChatterService.create() salvează post cu mentions[] →
  for each userId in mentions: NotificationsService.create(type: SYSTEM) →
  Socket.IO push spre user logat → bell icon cu badge +1
```

### 12.6 Subscription MRR snapshot
```
Cron zilnic → CustomerSubscriptionsService.snapshotMrr() →
  sumă subscriptions active per plan →
  write în subscription_snapshots →
  Dashboard MRR/ARR/churn îl citește
```

---

## 13. Glosar termeni tehnici

| Termen | Explicație |
|--------|------------|
| **Multi-tenancy** | Aceeași bază de date servește mai multe companii (tenants) izolate — fiecare vede doar datele ei. |
| **RLS (Row-Level Security)** | Postgres filtrează automat rows bazat pe `tenant_id` curent, chiar dacă dezvoltatorul uită să filtreze. |
| **TenantContextMiddleware** | Middleware Nest care citește `req.user.tenantId` (populat de JwtAuthGuard) și îl pune în `AsyncLocalStorage` pentru durata request-ului. Nu există un „TenantGuard" — rolul lui e împărțit între JwtAuthGuard + RolesGuard + acest middleware. |
| **Prisma extension (`tenantExtension`)** | Înlocuitorul Prisma v5+ al vechiului `$use` middleware. Aplicat prin `$extends` în `PrismaService.onModuleInit`; `applyTenantScope()` injectează `tenantId` în `where`/`data` pe fiecare tx deschisă cu `runWithTenant`. |
| **`runWithTenant(tenantId, mode, fn)`** | Deschide o tranzacție pe clientul extins, face `SET LOCAL app.tenant_id` + `SET LOCAL ROLE app_user` (NOSUPERUSER, NOBYPASSRLS), opțional `SET LOCAL transaction_read_only` pentru replica. Acolo lucrează cele 3 straturi de defense-in-depth simultan. |
| **BullMQ** | Queue Redis pentru jobs async (reminders, exports, AI enrichment). |
| **Outbox pattern** | Scriu evenimentul în DB în aceeași tranzacție cu modificarea; un worker separat îl publică spre Redis Streams. Garantează consistență. |
| **Cursor pagination** | Paginare bazată pe ID cursor, nu offset — mai eficientă pentru date mari. |
| **Presigned URL** | Link temporar (15min) generat de MinIO care permite upload/download fără credențiale permanente. |
| **Polymorphic subject** | Un model (Note/Chatter/Attachment) se poate lega de orice entitate via `subjectType` + `subjectId`. |
| **TSVector** | Tip Postgres pentru full-text search indexat (folosit pentru căutare globală). |
| **pgvector** | Extensie Postgres pentru embeddings AI (similarity search). |
| **pg_trgm** | Extensie Postgres pentru fuzzy match (duplicate detection). |
| **HMAC-SHA256** | Semnătură criptografică pentru webhooks — clientul verifică că payload-ul vine de la noi. |
| **TOTP** | Time-based One-Time Password — codul de 6 cifre din Google Authenticator. |
| **SAML** | Standard SSO enterprise (Okta, Azure AD). |
| **TSV (tsvector)** | Search index Postgres. |
| **Diarization** | AI detectează cine vorbește când într-un apel cu mai mulți participanți. |
| **PII redaction** | Presidio anonimizează date personale în transcripții (CNP, nume, adrese). |

---

## Anexă: Gap față de Salesforce

Pentru viziunea de a ajunge la nivel Salesforce, mai lipsesc:

| Funcție Salesforce | Stare AMASS | Efort |
|--------------------|-------------|-------|
| Lightning App Builder (drag-drop UI) | ❌ Nu | 2-3 luni |
| Flow Builder vizual (workflows drag) | ⚠️ Parțial (API DA, UI NU) | 2-4 săptămâni |
| AppExchange marketplace | ❌ Nu (vezi 11.2) | 3-6 luni |
| Einstein AI Analytics | ⚠️ Parțial (enrichment + scoring) | 1-2 luni |
| Mobile native apps (iOS/Android) | ❌ Nu (avem PWA) | 3-4 luni |
| Sandbox environments (dev/staging izolate per tenant) | ❌ Nu | 1 lună |
| Process Builder + Apex custom code | ⚠️ Workflows simple | 2 luni |
| Community Cloud (portal partners) | ⚠️ Portal clienți simplu | 1 lună |
| Einstein GPT (AI agent conversațional) | ❌ Nu | 1-2 luni |
| Offline mobile sync | ❌ Nu | 2 luni |
| Field History Tracking (granular) | ⚠️ Audit log generic | 1 săptămână |
| Role hierarchy + data sharing rules | ⚠️ RBAC simplu | 2-3 săptămâni |
| Gantt vizual pentru proiecte | ❌ Nu (vezi 11.1) | 3-5 zile |
| Campaign automation from workflow | ❌ Nu (vezi 11.3) | 1-2 zile |
| Revenue Cloud (CPQ, Billing avansat) | ⚠️ Quotes + Subscriptions simple | 3-4 luni |
| Marketing Cloud Journey Builder | ⚠️ Email Sequences simple | 2-3 luni |

**Concluzie sinceră:** AMASS-CRM acoperă 60-70% din Salesforce Starter Suite (entry-level). Pentru **IMM-uri românești**, funcționalitatea actuală e **comparabilă cu Salesforce Professional** (€75/user/lună) — cu avantaje mari: prețul (zero licență), integrare ANAF e-Factura nativă, UI în română, găzduire EU (GDPR).

Gap-urile mari spre Salesforce Enterprise (€165+/user/lună):
1. Ecosistem integrări (AppExchange)
2. Customizare vizuală end-user (fără cod)
3. Mobile native
4. Flow Builder vizual
5. Einstein GPT

---

*Document generat automat de Claude Code. Actualizează după fiecare sprint major.*
*Ultima actualizare: 2026-04-21*



