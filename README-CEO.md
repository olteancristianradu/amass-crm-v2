# AMASS CRM — Manual de utilizare (pentru conducere)

> Ghid complet, fără termeni tehnici, pentru a înțelege și folosi AMASS CRM.
> Pentru detalii tehnice → vezi `README.md`. Pentru catalog funcții → `docs/FEATURES.md`.

---

## Cuprins

1. [Ce este AMASS CRM și pentru cine e](#1-ce-este-amass-crm)
2. [Primul login și primii pași](#2-primul-login)
3. [Ghid pas cu pas — toate funcțiile](#3-ghid-pas-cu-pas)
4. [Import date (CSV + GestCom)](#4-import-date)
5. [Gestionare echipă și conturi](#5-gestionare-echipa)
6. [Planificat vs implementat](#6-planificat-vs-implementat)
7. [Întrebări frecvente](#7-intrebari-frecvente)

---

## 1. Ce este AMASS CRM

Platformă completă de management relații clienți pentru IMM-uri din România și UE, cu focus pe:

- **Vânzări:** pipeline vizual, oferte, comenzi, facturi, comisioane, prognoze
- **Comunicare:** email, apeluri telefonice cu transcriere automată, WhatsApp, SMS
- **Suport:** tichete cu SLA, escalare automată
- **Marketing:** campanii, segmente, evenimente, scoring AI
- **Conformitate RO:** facturare electronică ANAF, GDPR

**Pentru cine e:**
- Companii B2B care vând produse/servicii complexe (consultanță, IT, industrial, echipamente)
- Companii B2C cu valoare medie mare per client (imobiliare, medical, educație)
- Echipe 5-500 persoane, Romania sau EU

**Ce îl face diferit:**
- UI în română, nativ
- Integrare ANAF e-Factura inclusă
- Transcripție apeluri automată (cu AI)
- Găzduit EU (GDPR strict)
- Fără licențe per-user scumpe — model SaaS transparent

---

## 2. Primul login

### Pas 1: Primești invitația
Email cu link → setează parolă → login.

### Pas 2: Configurare inițială (OWNER/ADMIN)
1. **Setări → Utilizatori** → invită echipa (rol + email)
2. **Setări → Telefonie** → conectează Twilio (dacă faci apeluri din CRM)
3. **Setări → Email** → credențiale SMTP pentru trimitere email-uri (merge cu SendGrid SMTP, Mailgun, Postmark, serverul propriu etc.)
4. **Setări → Securitate 2FA** → activează (recomandat pentru toți)
5. **Pipeline vânzări** → setează stadiile tale personalizate

### Pas 3: Import date
Vezi secțiunea 4 mai jos.

---

## 3. Ghid pas cu pas

### 3.1 Companii
Evidența firmelor cu care lucrezi.
- **Creare:** `Companii → Adaugă` → nume, CUI, industrie, adresă
- **Ierarhie:** setează "Companie părinte" pentru subsidiare
- **Tab-uri pe detail:** Overview, Contacte, Deals, Note, Atașamente, Cronologie, Subsidiare

### 3.2 Contacte
Persoanele din companii.
- **Creare rapidă:** din Company Detail → tab Contacte → Adaugă
- **Câmpuri:** nume, poziție, email, telefon, LinkedIn, custom fields
- **Integrare:** click "Apel" → pornește apel Twilio; click "Email" → deschide composer

### 3.3 Clienți (B2C)
Persoane fizice fără companie asociată — retail, servicii personale.
- Similar cu Contacte, dar stau singure (fără company)
- Pot avea acces la Portal (semnare oferte digital)

### 3.4 Leads
Prospecți necalificați înainte să devină contacte reale.
- **Scoring AI automat:** 0-100, recalculat când modifici lead-ul
- **Conversie:** buton "Convertește" → creează simultan Contact + Companie + Deal
- **UI:** `/app/leads` cu badge colorat per scor

### 3.5 Pipeline (Deals)
Oportunități concrete cu valoare și probabilitate.
- **Vizualizare:** Kanban cu drag-and-drop între stadii
- **Închidere:** mută în WON sau LOST → se declanșează automat (comisioane, proiecte)
- **Istoric stadii:** tracking automat în audit

### 3.6 Prognoze (Forecasting)
Proiecție pipeline × probabilitate vs cota echipei.
- **Filtrare:** per user, per perioadă (lună/trimestru/an)
- **Indicatori:** quota attainment %, best case, commit, pipeline coverage

### 3.7 Contracte
Stocare PDF semnate cu tracking expirare.
- **Alertă auto:** 30 zile înainte de `endDate` → email + reminder
- **Auto-renewal flag** pentru abonamente

### 3.8 Proiecte
Implementări după Deal WON.
- **Task-uri legate** cu scadență și assignee
- **Urmare:** Deal WON → UI sugerează "Creează proiect?"
- *Lipsă:* vizualizare Gantt (în roadmap, vezi secțiunea 6)

### 3.9 Oferte (Quotes)
- **Creare:** din Deal → Adaugă ofertă → linii (produs/serviciu, qty, preț)
- **Calcul automat:** discount, TVA, total
- **Aprobare:** dacă depășește pragul, redirect spre manager
- **Trimitere:** email PDF + link portal pentru semnătură digitală

### 3.10 Comenzi (Orders)
După oferta acceptată.
- **Status:** DRAFT → CONFIRMED → FULFILLED → INVOICED
- **Line items** din ofertă clonate; poți modifica

### 3.11 Facturi
- **Creare:** manuală sau din Order
- **Emitere ANAF:** buton "Trimite la ANAF" → validare + status tracking
- **Plăți parțiale:** adaugi tranzacție → status actualizat automat

### 3.12 Tichete suport (Cases)
- **Prioritate:** LOW/NORMAL/HIGH/URGENT (determină SLA deadline)
- **Escalation automată:** cron la 15 min bump-uiește la HIGH/URGENT dacă SLA depășit
- **KPI dashboard:** "tichete peste SLA"

### 3.13 Campanii marketing
- **Multi-canal:** email / SMS / WhatsApp
- **Audience:** segment de contacte
- **Metrici:** open rate, click rate, conversii, ROI vs buget

### 3.14 Abonamente (MRR)
Dacă ai model SaaS sau servicii recurente.
- **Dashboard:** MRR total, ARR, churn rate lunar, snapshot pe plan
- **Tracking:** startDate, cancelDate, valoare lunară per client

### 3.15 Comisioane
- **Plan per agent:** % din valoarea deal-urilor WON
- **Calcul automat lunar:** buton "Computează luna aprilie" → walk pe deals WON × plan
- **Mark-paid:** după plată salariu, bifează plătit

### 3.16 Teritorii
Zone geografice sau industriale cu agenți asignați.
- **Folosire:** routing leads noi spre agentul zonei
- **Rapoarte:** performance per teritoriu

### 3.17 Evenimente
Conferințe, webinare, workshop-uri.
- **Invitați:** din segmente
- **Status prezență:** INVITED → REGISTERED → ATTENDED → NO_SHOW
- **Follow-up post-eveniment:** email automat + task pentru agent

### 3.18 Email
- **Trimitere:** din contact/deal/company → composer
- **Tracking:** deschideri + click-uri vizibile în activity log
- **Templates:** salvează formule recurente

### 3.19 Apeluri
- **Click-to-call:** buton în contact detail → Twilio formează numărul
- **Transcriere AI:** după apel → text complet + rezumat Claude (cine vorbește când, puncte cheie, next steps)
- **PII redaction:** CNP-uri, adrese sunt anonimizate automat în transcripție

### 3.20 WhatsApp
- **Inbox comun:** conversații threaded per contact
- **Templates aprobate** pentru outreach mass (business API Twilio)

### 3.21 SMS
- **Single + mass**
- **Folosire:** OTP, reminder plată, campanii scurte

### 3.22 Task-uri
- **Ale mele:** tab personal cu ce ai de făcut azi
- **Legate la subject:** Company/Deal/Project

### 3.23 Reminder-uri
- **Alerte programate:** "Sună pe X la ora 14:00 mâine"
- **Notificare:** in-app + email la scadență

### 3.24 Note
- **Text scurt** pe orice entitate (Company/Contact/Deal)
- **Istoric:** vezi toate notele cronologic

### 3.25 Atașamente
- **Upload:** drag-and-drop în tab Atașamente
- **Storage:** MinIO (S3-compatible), criptat la rest
- **Download:** link temporar 15 min

### 3.26 Chatter (feed intern)
- **Comentarii sociale** pe orice deal/company/proiect
- **@mențiuni:** tag coleg → notificare instant
- **Istoric:** cronologic, doar autorul poate edita/șterge

### 3.27 Automatizări (Workflows)
- **Trigger:** eveniment (ex: Deal WON)
- **Acțiuni:** creează task, trimite email, notă, notificare
- **Builder:** UI drag & drop simplu
- *Lipsă:* declanșare Campanie din Workflow (vezi secțiunea 6)

### 3.28 Rapoarte
- **Predefinite:** dashboard cu KPI-uri standard
- **Builder custom:** alegi entitate + coloane + filtre + export CSV

### 3.29 Câmpuri custom
- **Pe orice entitate:** Company, Contact, Deal etc.
- **Tipuri:** text, număr, dată, boolean, select, multi-select
- **Pagină:** `Setări → Câmpuri custom`

### 3.30 Reguli de validare
- **Blochează salvare** dacă un câmp nu respectă condițiile
- **Exemple:** email valid (regex), telefon 10 cifre, nume minim 3 caractere

### 3.31 Câmpuri formula
- **Calcul automat** pe baza altor câmpuri
- **Exemplu:** `nume_complet = CONCAT(prenume, " ", nume)`
- **Operații:** +, -, *, /, CONCAT, IF, UPPER, LOWER, LEN

### 3.32 Aprobări
- **Policy-based:** dacă ofertă > 50.000 lei → manager aprobă
- **UI:** `/app/approvals` cu pending + istoric

### 3.33 Segmente contacte
- **Filtre dinamice salvate**
- **Exemplu:** "Contacte IT din București cu deal WON > 10k în ultimele 90 zile"
- **Folosire:** audiență campanii, export

### 3.34 Export
- **Orice entitate** → CSV async (se generează în background)
- **Email link download** când e gata

### 3.35 Duplicate detection
- **Fuzzy match** nume/email/telefon
- **Tool merge:** alegi "master" + combini datele

### 3.36 Search global
- **Bar de căutare sus** în toate paginile
- **Caută în:** companii, contacte, deals, facturi
- **Tehnologie:** Postgres full-text search (rapid chiar și la 1M+ rows)

### 3.37 Setări utilizatori
- **Invite:** email + rol (OWNER/ADMIN/MANAGER/AGENT/VIEWER)
- **Dezactivare:** păstrează istoricul dar blochează accesul

### 3.38 Securitate 2FA
- **Google Authenticator / Authy**
- **Setup:** Setări → 2FA → scan QR code → confirmă cu 6 cifre
- **Recomandat:** obligatoriu pentru OWNER + ADMIN

### 3.39 Jurnal audit
- **Toate mutațiile loggate** (cine a schimbat ce când)
- **Folosire:** GDPR, forensics, investigații
- **Acces:** doar OWNER + ADMIN

### 3.40 GDPR
- **Export date personale** per contact (right to access)
- **Ștergere:** anonymize (păstrăm audit trail fără date personale)

### 3.41 Webhooks
- **Trimite evenimente** spre sisteme externe (Zapier, n8n, ERP client)
- **Exemple:** deal.won, invoice.paid, case.escalated
- **Semnare:** HMAC-SHA256 (clientul verifică integritatea)

### 3.42 Facturare SaaS (Billing)
- **Abonamentul TĂU la AMASS-CRM**
- **Plata:** card prin Stripe
- **Plan:** Starter / Pro / Enterprise

### 3.43 PWA mobile
- **Install pe telefon:** browser → "Add to home screen"
- **Offline shell:** paginile cached funcționează fără internet
- **Push notifications** (iOS 16.4+, Android)

### 3.44 Calendar
- **Sync 2-way:** Google Calendar + Outlook + CalDAV
- **Meetings CRM** apar în calendar personal și invers

### 3.45 Secvențe email
- **Cadențe multi-pas:** Ziua 0 → Ziua 3 → Ziua 7
- **Oprire la răspuns:** dacă contactul răspunde, secvența se oprește

### 3.46 Email-tracking
- **Pixel open + click URLs**
- **Vizibil:** timeline contact + dashboard campaigns

### 3.47 Portal clienți
- **Link public securizat** (token expirabil)
- **Clientul:** vede oferte, semnează digital, descarcă facturi, deschide tichete
- **Fără login:** acces pe bază de token email

### 3.48 ANAF e-Factura
- **Obligatoriu RO** B2B din iulie 2024
- **Emitere automată** din pagina Facturi → "Trimite ANAF"
- **Status tracking:** SENT → VALIDATED → ACCEPTED

### 3.49 SSO Enterprise (SAML)
- **Integrare** Okta / Azure AD / Google Workspace
- **User-ul intră cu contul de companie**, fără parole separate

### 3.50 Lead Scoring AI
- **Scor 0-100** calculat automat per Lead
- **Bazat pe:** industrie, sursă, interacțiuni, profil BANT
- **Folosire:** prioritizare — sună întâi lead cu scor > 80

### 3.51 AI Enrichment
- **Claude analizează** compania → sugerează industrie, mărime, next step
- **Non-destructiv:** afișat ca "sugestii AI" — tu decizi dacă accepți

---

## 4. Import date

### 4.1 Import CSV generic
1. `Setări → Import date → CSV`
2. Selectează fișier (max 50 MB)
3. Mapare coloane CSV → câmpuri CRM (drag & drop)
4. Preview primele 10 rânduri
5. **Dry-run:** validează fără salvare
6. **Commit:** salvează tot + raport (X reușite, Y duplicate, Z erori)

### 4.2 Import GestCom
Pentru clienți care migrează de la GestCom (ERP popular RO):
1. Export GestCom → fișier .dbf sau .xml
2. Setări → Import → GestCom
3. Upload → mapare automată (entități recunoscute: firme, facturi, produse)
4. Preview + commit

### 4.3 Import manual via API
Pentru integratori:
```bash
POST /api/v1/companies
Authorization: Bearer <JWT>
Content-Type: application/json
{ "name": "...", "taxId": "RO...", ... }
```

---

## 5. Gestionare echipă

### 5.1 Roluri disponibile
| Rol | Drepturi |
|-----|----------|
| **OWNER** | Tot. Inclusiv billing, șters tenant |
| **ADMIN** | Tot, exceptând billing și ștergere tenant |
| **MANAGER** | Echipa lui (subordonați) — vede și editează datele lor |
| **AGENT** | Doar datele proprii |
| **VIEWER** | Read-only pe toate datele |

### 5.2 Invitare user nou
1. `Setări → Utilizatori → Invită`
2. Email + nume + rol + manager (opțional)
3. User primește email cu link → setează parolă → gata

### 5.3 Dezactivare user
Nu ștergem — doar dezactivăm. Istoricul rămâne (pentru audit + GDPR).

### 5.4 Resetare parolă
User: pagina login → "Am uitat parola" → email cu link (15 min).
Admin forțat: Setări → Utilizatori → user → "Forțează resetare parolă".

### 5.5 2FA obligatoriu
Setări tenant → Policy → "Require 2FA for ADMIN/OWNER" — la login refuză dacă nu au 2FA.

---

## 6. Planificat vs implementat

### Implementat (Tier B+C complete)

Toate cele 51 funcții de mai sus sunt funcționale. Vezi `STATUS.md` pentru detalii.

### Planificat (rămase nice-to-have)

**1. Gantt view Proiecte** — diagramă vizuală task-uri cu bare orizontale pe axă timp, dependențe, drum critic. Necesită biblioteca `gantt-task-react`. Efort estimat: 3-5 zile.

**2. Marketplace integrări** — echivalent AppExchange (Salesforce) / App Marketplace (HubSpot). Dezvoltatori externi publică aplicații ce extind CRM-ul. Necesită sistem plugin runtime + SDK public + OAuth per app + billing revenue share. Efort: 3-6 luni full-time. **Nu recomandat MVP solo.**

**3. Campaign Automation Trigger** — Workflow declanșează automat o Campanie întreagă (nu doar email individual). Caz uz: "Contact nou în segment VIP → auto-enroll în Campania 'VIP Welcome'". Efort: 1-2 zile.

---

## 7. Întrebări frecvente

**Q: Pot să folosesc CRM-ul gratuit?**
A: Da, self-hosted pe propriul VPS = zero licență. Doar costul VPS-ului (~10 EUR/lună) + Twilio (dacă folosești apeluri) + SMTP (orice provider — SendGrid/Mailgun/self-hosted) după uzaj.

**Q: Datele sunt în siguranță?**
A: 3 straturi izolare tenant + JWT + 2FA + rate limiting + criptare la rest (MinIO) + HMAC pe webhooks. Vezi secțiunea Securitate în README.md tehnic.

**Q: Cum migrez de pe alt CRM?**
A: Import CSV generic sau GestCom (RO). Pentru Salesforce/HubSpot, export CSV din sistemul vechi → mapare coloane.

**Q: Suportă limba engleză?**
A: UI e în română. Putem adăuga EN în 2-3 zile cu i18n (react-intl).

**Q: Pot customiza pipeline-ul?**
A: Da — stadii + probabilitate + culoare per tenant. Multi-pipeline suportat (ex: Enterprise + SMB separate).

**Q: Există app mobile?**
A: PWA instalabil (iOS + Android). Native încă nu.

**Q: Cât durează implementarea?**
A: Self-service cu doc ~1 zi. Cu consultanță + training + import → 1-2 săptămâni.

**Q: Se integrează cu ERP-ul meu?**
A: Da, via webhooks (outbound) + API REST (inbound). Zapier/n8n bridge imediat.

**Q: Cine deține datele?**
A: Tu (tenant owner). Export complet oricând. GDPR compliant.

---

*Pentru suport tehnic: vezi README.md secțiunea Debugging.*
*Ultima actualizare: 2026-04-21*
