# DEPLOY.md — AMASS-CRM v2 live deploy + Whisper/Presidio setup

Ghidul ăsta îți spune cum să pui proiectul live (Hetzner/Railway VPS)
și cum să activezi Whisper + Presidio ca să pot testa transcripția reală.

## Cuprins

1. [Pre-flight — ce trebuie să ai](#1-pre-flight)
2. [Setup VPS minim](#2-setup-vps)
3. [Env vars obligatorii](#3-env-vars)
4. [Deploy cu docker-compose](#4-deploy)
5. [DNS + Caddy HTTPS](#5-dns-caddy)
6. [Migrații + seed primul tenant](#6-migratii)
7. [Activare Whisper (transcripție reală)](#7-whisper)
8. [Activare Presidio (redactare PII reală)](#8-presidio)
9. [Twilio + Stripe + ANAF setup](#9-integrari)
10. [Verificare post-deploy](#10-verificare)
11. [Ce pot testa EU (Claude) odată ce e live](#11-claude-tests)
12. [Rollback + troubleshooting](#12-rollback)

---

## 1. Pre-flight

Ai nevoie de:

- **Domeniu** (ex. `crm.amass.ro`). Orice registrar merge.
- **VPS Linux** cu 4 GB RAM minim (8 GB dacă activezi Whisper `medium`). Recomandare: Hetzner CX31 (~10 €/lună) sau Hetzner CX41 cu GPU dacă vrei Whisper fast.
- **Cont Twilio** (voice + SMS + WhatsApp Business) — Account SID, Auth Token, un număr E.164 românesc.
- **Cont Stripe** — Secret key (`sk_live_…`) + webhook signing secret.
- **Cont Anthropic** — API key pentru `claude-sonnet-4-6` (rezumate apeluri).
- **Cont ANAF developer.anaf.ro** + certificat calificat — doar dacă emiți e-factura. Altfel poți sări.
- **SMTP** pentru email outbound (SendGrid SMTP, Mailgun, Postmark, sau server propriu).
- **Git clone acces** la `olteancristianradu/amass-crm-v2`.

Toate OPȚIONALE exceptând VPS + domeniu + Twilio (pentru calls) dacă vrei feature-ul întreg. Fără ele, CRM-ul tot pornește, doar că modulele lor returnează „not configured".

---

## 2. Setup VPS

Pe un Ubuntu 22.04/24.04 curat:

```bash
# 1. Update + Docker
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Swap (util dacă VPS are <8GB și pornești Whisper)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 3. Firewall — doar 80/443/22 deschise
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable

# 4. Clone repo
git clone https://github.com/olteancristianradu/amass-crm-v2.git /opt/amass
cd /opt/amass
```

---

## 3. Env vars

Copiază `.env.example` → `.env` și umple. Minim obligatoriu pentru boot:

```bash
cp .env.example .env
nano .env  # completează:
```

**Core (mandatory):**
```
DATABASE_URL=postgresql://postgres:STRONGPASS@postgres:5432/amass_crm?schema=public
REDIS_URL=redis://redis:6379
MINIO_ENDPOINT=https://files.crm.amass.ro  # sau http://minio:9000 dacă nu expui
MINIO_ACCESS_KEY=<32-char random>
MINIO_SECRET_KEY=<32-char random>
MINIO_BUCKET=amass-files

# Generate cu: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<64 hex chars>
JWT_REFRESH_SECRET=<64 hex chars, DIFFERENT>
ENCRYPTION_KEY=<64 hex chars — AES-256-GCM>
AI_WORKER_SECRET=<32-char random>

# Origin allow-list — înlocuiește cu domeniul tău
CORS_ALLOWED_ORIGINS=https://crm.amass.ro
PUBLIC_API_BASE_URL=https://api.crm.amass.ro
```

**Opționale (unlock features):**
```
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_WEBHOOK_BASE_URL=https://api.crm.amass.ro
TWILIO_SMS_FROM=+40700000000

ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…              # pentru embeddings
GEMINI_API_KEY=…                 # free tier alternativ

STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_STARTER=price_…
STRIPE_PRICE_GROWTH=price_…
STRIPE_PRICE_ENTERPRISE=price_…

SENTRY_DSN=https://…@sentry.io/…
LOG_LEVEL=info

# Whisper — lasă "off" acum; activare în §7
WHISPER_MODEL=off
```

**Producție checks** (loadEnv() refuză să pornească dacă încalci astea):
- `JWT_SECRET` + `JWT_REFRESH_SECRET` ≥32 chars
- `MINIO_ACCESS_KEY` + `MINIO_SECRET_KEY` ≠ `minioadmin`
- `ENCRYPTION_KEY` ≠ toate zero-uri
- `CORS_ALLOWED_ORIGINS` nu conține `*`
- `METRICS_ALLOWED_IPS` sau `METRICS_AUTH_TOKEN` setat

---

## 4. Deploy

> **Pe Railway, sari la §4.1.** Secțiunile 4/5 descriu deployul cu
> docker-compose + Caddy pe un VPS propriu (Hetzner etc.), care îți dă cel
> mai mult control. Railway ia costuri mai mari per GB RAM dar are DX mai
> rapid pentru primul MVP.

### 4.0 docker-compose pe VPS propriu

```bash
cd /opt/amass

# Pornește întregul stack (dev profile; prod profile adaugă PgBouncer)
docker compose -f infra/docker-compose.yml --env-file .env up -d

# Verifică — toate trebuie healthy
docker ps --format 'table {{.Names}}\t{{.Status}}'
# amass-postgres     Up ... (healthy)
# amass-redis        Up ... (healthy)
# amass-minio        Up ... (healthy)
# amass-api          Up ...
# amass-web          Up ...
# amass-ai-worker    Up ...
# amass-caddy        Up ...

# Log tail pentru primele 2 minute — cauți "amass-api listening" și zero erori
docker compose -f infra/docker-compose.yml logs -f api ai-worker
```

Dacă vrei PgBouncer în fața Postgres:
```bash
docker compose -f infra/docker-compose.yml --profile prod up -d pgbouncer
# Apoi schimbă DATABASE_URL să puncteze la pgbouncer:5432 cu
# ?pgbouncer=true&statement_cache_size=0
# și lasă un DATABASE_DIRECT_URL pe postgres:5432 pentru `prisma migrate`.
```

### 4.1 Deploy pe Railway

Railway e cea mai simplă variantă dacă nu vrei să administrezi un VPS —
dar **monorepo-ul pnpm are 3 deployables separate** (api / web / ai-worker),
deci ai nevoie de 3 servicii Railway, plus Postgres + Redis + MinIO ca addon-uri.

> **Eroarea `Dockerfile 'Dockerfile' does not exist`** apare când Railway
> nu știe unde e Dockerfile-ul. Root-ul repo-ului NU are `Dockerfile` —
> fiecare app are al ei. Fix-ul e mai jos.

#### 4.1.1 Addon-uri (din Railway dashboard → New → Database)

1. **Postgres 16** → copiază `DATABASE_URL` în variabilele serviciului `api`.
2. **Redis 7** → copiază `REDIS_URL` în `api` și `ai-worker`.
3. MinIO **nu există** ca addon Railway. Alternative:
   - Folosește **Cloudflare R2** (compatibil S3): cost zero-egress, ~0.015$/GB.
     Setează `MINIO_ENDPOINT=https://<acct>.r2.cloudflarestorage.com`,
     `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`.
   - Sau **Backblaze B2** / AWS S3 — același API.
   - Rula MinIO ca al 4-lea serviciu Railway (imagine `minio/minio`).

#### 4.1.2 Cele 3 servicii (api, web, ai-worker)

Pentru **fiecare serviciu** în Railway dashboard (New Service → GitHub repo):

| Setting | `api` | `web` | `ai-worker` |
|---|---|---|---|
| Root Directory | `apps/api` | `apps/web` | `apps/ai-worker` |
| Builder | Dockerfile | Dockerfile | Dockerfile |
| (auto-picked from) | `apps/api/railway.toml` | `apps/web/railway.toml` | `apps/ai-worker/railway.toml` |
| Public networking | ON | ON | OFF (internal only) |
| Healthcheck | `/api/v1/health` | (none) | `/health` |

`railway.toml` existente în fiecare `apps/*` setează `buildContextPath = "../.."`
ca build-ul să pornească din rădăcina repo-ului (workspace pnpm are nevoie
ca `@amass/shared` să se rezolve — fără asta pica `pnpm install`).

#### 4.1.3 Variabile de env pe Railway

Pune pe serviciul `api` (marchează `Secret` pe toate):

```
DATABASE_URL          ← referința la Postgres addon (Reference Variable)
REDIS_URL             ← referința la Redis addon
MINIO_ENDPOINT        ← URL-ul R2/B2/S3
MINIO_ACCESS_KEY      ← secret
MINIO_SECRET_KEY      ← secret
MINIO_BUCKET          amass-files
JWT_SECRET            ← 64 hex chars
JWT_REFRESH_SECRET    ← 64 hex chars, diferit
ENCRYPTION_KEY        ← 64 hex chars
AI_WORKER_SECRET      ← shared cu ai-worker
CORS_ALLOWED_ORIGINS  https://<web-domeniu-Railway-sau-al-tău>
PUBLIC_API_BASE_URL   https://<api-domeniu-Railway-sau-al-tău>
TWILIO_*, STRIPE_*, ANTHROPIC_API_KEY, SENTRY_DSN   (opționale — vezi §3)
PORT                  ← NU-l seta; Railway îl injectează automat
```

Pe `web`:
```
VITE_API_BASE_URL=https://<api-domeniu-Railway>
```
(setează-l înainte de build; Vite îl inline-ează în bundle.)

Pe `ai-worker`:
```
REDIS_URL, MINIO_*, AI_WORKER_SECRET  ← identic cu api
WHISPER_MODEL         off (activezi mai târziu — §7)
PRESIDIO_ENABLED      false
ANTHROPIC_API_KEY     ← pentru sumare
```

#### 4.1.4 Deploy

Odată ce cele 3 servicii sunt create + variabilele puse:
1. Push pe `main` → Railway redeployează automat (builder trigger).
2. După build (5-10 min prima dată), Railway atribuie URL-uri gratuite:
   `api-production-abc.up.railway.app`. Schimbă-le în domenii proprii din
   Settings → Domains.
3. Rulează migrațiile manual o dată prin **Railway CLI** (vezi §6):
   ```bash
   railway run --service api pnpm prisma migrate deploy
   ```
4. Apoi înregistrează primul tenant (vezi §6 — același curl cu URL-ul Railway).

#### 4.1.5 Limite de resurse Railway

Whisper `small` are nevoie de **~4 GB RAM** în runtime. Planul gratuit
Railway e 512 MB → insuficient. Pentru ai-worker cu Whisper activ ai
nevoie minim de **Pro plan + 4 GB service** (~20$/lună doar ai-worker).
Dacă vrei Whisper pe Railway, activează-l după ce upgradezi serviciul.

---

## 5. DNS + Caddy HTTPS

În DNS (la registrar sau Cloudflare):

```
A     crm.amass.ro          → IP VPS
A     api.crm.amass.ro      → IP VPS
A     files.crm.amass.ro    → IP VPS  (pentru presigned MinIO)
```

Editează `infra/Caddyfile` pe server:

```
crm.amass.ro {
  reverse_proxy web:80
}
api.crm.amass.ro {
  reverse_proxy api:3000
}
files.crm.amass.ro {
  reverse_proxy minio:9000
}
```

Caddy ia certificate Let's Encrypt automat la primul request. Verifică:

```bash
curl -I https://api.crm.amass.ro/api/v1/health
# HTTP/2 200
# content-type: application/json
# x-request-id: req_...
```

---

## 6. Migrații + seed primul tenant

Aplică schema:

```bash
docker exec amass-api pnpm prisma migrate deploy
# 29 migrations found in prisma/migrations
# Applying migration `20260407205731_init`
# ...
# All migrations have been successfully applied.
```

Verifică RLS e activ pe TOATE tabelele tenant-scoped (după `20260422100000_rls_remaining_tables` ar trebui 78/79 cu RLS; tenants e self):

```bash
docker exec amass-postgres psql -U postgres -d amass_crm -c "
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables WHERE schemaname='public'
  AND tablename NOT IN ('_prisma_migrations','tenants')
ORDER BY tablename;
" | head -40
# Toate coloanele rowsecurity + forcerowsecurity = 't'
```

Creează primul tenant + owner via endpoint public:

```bash
curl -X POST https://api.crm.amass.ro/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{
    "tenantSlug": "amass",
    "tenantName": "Amass SRL",
    "email": "owner@amass.ro",
    "password": "CHANGE_ME_strong_pass_12_chars",
    "fullName": "Cristi Radu"
  }'
# { "user": {...}, "tenants": [...], "tokens": { "accessToken": "..." } }
```

Autentifică-te din browser: https://crm.amass.ro → slug `amass` + email + parola.

---

## 7. Whisper (transcripție reală)

**Default:** `WHISPER_MODEL=off` → apelurile înregistrate primesc text
placeholder `"[stub transcript]"`. Ca să se facă transcripția reală:

### 7.1 Alege modelul după resursa VPS:

| Model    | RAM   | Viteză (CPU Xeon 4 cores) | Calitate | Recomandare |
|----------|-------|---------------------------|----------|-------------|
| `tiny`   | 1 GB  | ~5× real-time             | slabă pt RO | doar test |
| `base`   | 2 GB  | ~3× real-time             | decentă pt RO | **default** |
| `small`  | 4 GB  | ~1× real-time             | bună | producție CPU |
| `medium` | 8 GB  | ~0.3× real-time (mai lent decât apelul) | f.b. | nevoie GPU |
| `large-v3` | 16 GB | GPU obligatoriu | excelentă | Hetzner GPU |

Pentru un VPS fără GPU cu 8 GB RAM recomand `small`. Pentru test, `base`.

### 7.2 Activare (pe host):

```bash
cd /opt/amass/apps/ai-worker

# 1. Uncomment liniile Whisper în requirements.txt
sed -i 's/^# openai-whisper/openai-whisper/' requirements.txt
sed -i 's/^# whisperx/whisperx/' requirements.txt
# (opțional, diarizarea: whisperx — cere licență pyannote.audio acceptată)

# 2. Actualizează env
sed -i 's/^WHISPER_MODEL=off/WHISPER_MODEL=small/' /opt/amass/.env

# 3. Rebuild doar ai-worker (pull torch + whisper + model, ~5-15 min)
cd /opt/amass
docker compose -f infra/docker-compose.yml build ai-worker
docker compose -f infra/docker-compose.yml up -d ai-worker

# 4. Verifică — health endpoint spune că e "real", nu "stub"
curl http://localhost:8000/health | jq
# {
#   "status": "ok",
#   "whisper_model": "small",
#   "transcription_mode": "real",   ← asta vrei
#   "redaction_mode": "stub",       ← Presidio în §8
#   "degraded": true                ← devine false după Presidio
# }
```

### 7.3 Test rapid:

```bash
# Trimite un fișier audio direct prin endpointul /process/call (admin-only)
curl -X POST http://localhost:8000/process/call \
  -H 'content-type: application/json' \
  -d '{
    "callId": "test-call-id",
    "tenantId": "<cuid-ul-tenantului-tau>",
    "recordingUrl": "https://filesamples.com/samples/audio/mp3/sample1.mp3",
    "recordingSid": "RE_test"
  }'
# { "status": "ok", "callId": "test-call-id", "result": { "transcript": "..." } }
```

### 7.4 GPU (opțional, dacă VPS are CUDA):

```bash
# Dockerfile are doar CPU. Pentru GPU:
# În apps/ai-worker/Dockerfile schimbă FROM python:3.12-slim →
# FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04
# + apt install python3.12 pip
# + docker run cu --gpus all
```

---

## 8. Presidio (redactare PII reală)

**Default:** `PRESIDIO_ENABLED=false` → PII-ul din transcript este marcat cu
placeholdere statice (`[REDACTED_EMAIL]`, `[REDACTED_PHONE]`). Activare:

### 8.1 Instalare pe ai-worker:

```bash
cd /opt/amass/apps/ai-worker

# 1. Uncomment liniile Presidio + modelul spaCy românesc în requirements.txt
sed -i 's/^# presidio-analyzer/presidio-analyzer/' requirements.txt
sed -i 's/^# presidio-anonymizer/presidio-anonymizer/' requirements.txt
sed -i 's/^# ro-core-news-lg/ro-core-news-lg/' requirements.txt

# 2. Activează în env
cat >> /opt/amass/.env <<'EOF'
PRESIDIO_ENABLED=true
PRESIDIO_LANGUAGE=ro
PRESIDIO_SPACY_MODEL=ro_core_news_lg
EOF

# 3. Rebuild ai-worker (+~500MB pentru spaCy RO)
cd /opt/amass
docker compose -f infra/docker-compose.yml build ai-worker
docker compose -f infra/docker-compose.yml up -d ai-worker

# 4. Verifică
curl http://localhost:8000/health | jq
# {
#   "whisper_model": "small",
#   "transcription_mode": "real",
#   "redaction_mode": "real",   ← asta vrei
#   "degraded": false           ← zero-dependency bypass dezactivat
# }
```

### 8.2 Entități detectate (built-in + custom RO):

- `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IP_ADDRESS`, `URL`, `LOCATION`, `PERSON` (din spaCy RO).
- **Custom RO (adăugate în `apps/ai-worker/src/redaction.py`):**
  - `RO_CNP` — 13 cifre, validare checksum. Pattern: `\b[1-9]\d{12}\b` + modulo-11.
  - `RO_IBAN` — `RO\d{2}[A-Z]{4}\d{16}`.
  - `RO_CIF` — CUI cu/fără `RO` prefix.

### 8.3 Test:

```bash
curl -X POST http://localhost:8000/process/redact \
  -H 'content-type: application/json' \
  -d '{
    "text": "Salut, sunt Ion Popescu, CNP 1850101123456, sună-mă la 0722123456 sau ion@example.com",
    "language": "ro"
  }'
# {
#   "redacted": "Salut, sunt [PERSON], CNP [RO_CNP], sună-mă la [PHONE_NUMBER] sau [EMAIL_ADDRESS]",
#   "entities": [
#     { "type": "PERSON", "start": 12, "end": 23 },
#     { "type": "RO_CNP", "start": 29, "end": 42 },
#     ...
#   ]
# }
```

---

## 9. Integrări externe

### 9.1 Twilio (voice + SMS)

1. **Cumpără un număr** cu capabilities **Voice + SMS** din consola Twilio
   (Phone Numbers → Buy a number → filtru `RO` / `+40`).
2. **Setează webhook-urile** pe numărul tău:
   - Voice URL: `https://api.crm.amass.ro/api/v1/webhooks/twilio/voice` (HTTP POST)
   - Status callback: `https://api.crm.amass.ro/api/v1/webhooks/twilio/status`
   - Recording callback: `https://api.crm.amass.ro/api/v1/webhooks/twilio/recording`
   - SMS URL: `https://api.crm.amass.ro/api/v1/webhooks/twilio/sms`
3. Rulează `TwilioService.configureNumber()` **o dată** prin admin endpoint
   (sau direct din consolă) — setează `statusCallbackEvent=initiated ringing answered completed`
   și `recordingStatusCallback`.
4. Env ([§3](#3-env-vars)): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WEBHOOK_BASE_URL`, `TWILIO_SMS_FROM`.
5. **Semnătură validată automat** — `TwilioSignatureGuard` verifică
   `X-Twilio-Signature` cu `AuthToken` pe fiecare POST. Nu trece-peste.

### 9.2 Stripe (billing)

1. Creează 3 produse + preturi recurring (Starter, Growth, Enterprise).
   Copiază `price_…` ID-urile în `.env` (`STRIPE_PRICE_*`).
2. Webhook Stripe:
   - URL: `https://api.crm.amass.ro/api/v1/webhooks/stripe`
   - Evenimente (Settings → Webhooks → Add endpoint → Select events):
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Copy signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
3. **Test:**
   ```bash
   stripe listen --forward-to https://api.crm.amass.ro/api/v1/webhooks/stripe
   stripe trigger customer.subscription.created
   # verifică în DB: SELECT * FROM subscriptions WHERE stripe_subscription_id='sub_...';
   ```

### 9.3 ANAF e-factura

Dacă nu facturezi către sectorul public, **sări secțiunea** — e-factura e opțională.

1. Aplică pe [developer.anaf.ro](https://developer.anaf.ro) pentru OAuth2 app.
   Callback URL: `https://api.crm.amass.ro/api/v1/anaf/oauth/callback`.
2. Primești `Client ID` + `Client Secret` → `.env`:
   ```
   ANAF_CLIENT_ID=...
   ANAF_CLIENT_SECRET=...
   ANAF_SANDBOX=true   # lasă sandbox până confirmi că UBL-ul trece
   ```
3. Ai nevoie de **certificat calificat** (e.g. certSIGN, DigiSign) + token USB
   pentru semnare. Fără el nu poți trimite e-factura în producție.
4. Setează tenant → `Settings → ANAF → Conectare` (OAuth flow).
5. Pentru test cu sandbox:
   ```bash
   # Trimite o factură în sandbox
   curl -X POST https://api.crm.amass.ro/api/v1/invoices/<id>/submit-anaf \
     -H "authorization: Bearer <token>"
   # Statusul se actualizează via cron (BullMQ): IN_VALIDATION → OK/NOK
   ```

---

## 10. Verificare post-deploy

Checklist rapidă după ce ai pornit stack-ul. Dacă vreun punct cade, vezi §12.

### 10.1 Healthchecks

```bash
# API
curl -s https://api.crm.amass.ro/api/v1/health | jq
# { "status": "ok", "uptime": 42, "db": "ok", "redis": "ok", "minio": "ok" }

# AI worker (din VPS — nu e expus public)
docker exec amass-api curl -s http://ai-worker:8000/health | jq
# { "status": "ok", "transcription_mode": "real", "redaction_mode": "real" }

# Web
curl -I https://crm.amass.ro
# HTTP/2 200
```

### 10.2 RLS + tenant isolation (foarte important)

```bash
docker exec amass-postgres psql -U postgres -d amass_crm -c "
SELECT
  COUNT(*) FILTER (WHERE rowsecurity AND forcerowsecurity) AS rls_on,
  COUNT(*) FILTER (WHERE NOT rowsecurity) AS rls_off,
  COUNT(*) AS total
FROM pg_tables
WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','tenants');
"
# rls_on trebuie să fie egal cu total - (excluded). Orice rls_off > 0 = BUG CRITIC.
```

### 10.3 Smoke test flow complet

```bash
# Login
TOKEN=$(curl -s -X POST https://api.crm.amass.ro/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"amass","email":"owner@amass.ro","password":"..."}' \
  | jq -r '.tokens.accessToken')

# Create company
curl -X POST https://api.crm.amass.ro/api/v1/companies \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"ACME SRL","cui":"RO12345678"}' | jq '.id'

# Create deal
curl -X POST https://api.crm.amass.ro/api/v1/deals \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Test","value":1000,"currency":"RON","pipelineId":"..."}' | jq

# Presigned upload (attachment)
curl -X POST https://api.crm.amass.ro/api/v1/attachments/presign \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"filename":"test.pdf","mimeType":"application/pdf","size":1024}' | jq
# { "uploadUrl": "https://files.crm.amass.ro/...", "storageKey": "..." }
```

### 10.4 Metrics + Sentry

```bash
# Prometheus metrics (allow-list IP sau token conform METRICS_*)
curl -s -H "authorization: Bearer $METRICS_AUTH_TOKEN" \
  https://api.crm.amass.ro/metrics | head -20

# Sentry: aruncă intenționat o 500 și verifică că ajunge în dashboard
curl https://api.crm.amass.ro/api/v1/__debug_force_500  # doar dacă e expus
```

---

## 11. Ce pot testa EU (Claude) odată ce e live

Ca să pot verifica Whisper + Presidio + fluxul de call real fără să ai tu
niciun număr Twilio activ, am nevoie de **un admin token cu rol OWNER** și
să-mi dai public (peste SSH / ngrok / domeniu public) accesul la:

- `https://api.crm.amass.ro/api/v1/*` (API-ul)
- `https://crm.amass.ro` (web — opțional, pot merge pe API-only)
- Portul AI worker `8000` (opțional, dacă vrei să fac test direct pe transcripție)

### 11.1 Ce îmi dai

```bash
# 1. Creează un user OWNER pentru mine (sau folosește-l pe al tău)
curl -X POST https://api.crm.amass.ro/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{
    "tenantSlug":"amass",
    "email":"claude@amass.ro",
    "password":"<parola_lunga_16_chars>",
    "fullName":"Claude Test"
  }'

# 2. Îmi dai într-un mesaj:
#    - URL-ul API (https://api.crm.amass.ro)
#    - Slug tenant (`amass`)
#    - Email + parola userului de test
#    - (opțional) IP-ul VPS-ului pentru dacă ai METRICS_ALLOWED_IPS setat
```

### 11.2 Ce pot face cu asta

| Test | Cum îl fac | Ce verific |
|---|---|---|
| **Login + refresh** | `POST /auth/login` → iau access+refresh token | JWT-ul e valid, `amass_rt` cookie e `HttpOnly; Secure` |
| **Tenant isolation** | Creez o companie; încerc s-o citesc cu token de la alt tenant | Trebuie 404 (nu 403!) — RLS o ascunde complet |
| **Upload attachment** | `POST /attachments/presign` → PUT pe MinIO → `POST /attachments/confirm` | Fișierul e în MinIO + rând în `attachments`, presigned GET funcționează 15 min |
| **Deal pipeline** | Creez deal, îl mut prin stages, verific `deal_stage_history` | Audit log are entries |
| **Simulez call** | `POST /process/call` direct pe ai-worker cu URL audio mostră | Whisper returnează text RO decent; Presidio înlocuiește PII |
| **Twilio replay** | Trimit POST ca Twilio pe `/webhooks/twilio/voice` cu `X-Twilio-Signature` valid | TwiML răspuns corect (`<Response><Dial…>…`) |
| **Stripe sim** | `stripe trigger customer.subscription.created` (tu rulezi local) | DB primește `Subscription` row |
| **GDPR export** | `POST /gdpr/export-request` + aștept job BullMQ | ZIP cu CSV-urile apare în MinIO, link presigned 1h |
| **Rate limiting** | 100 req/s pe `/auth/login` cu parolă greșită | Al 11-lea primește 429 |

### 11.3 Ce NU pot face

- **Apel real Twilio end-to-end** (nu pot răspunde telefonic). Dacă vrei să
  validez transcripția pe recording real, tu dai tu un call de test cu
  recording activat, iar eu fac re-run pe recording-ul salvat în MinIO
  (`POST /calls/<id>/retranscribe`).
- **Plată Stripe reală** — doar `stripe trigger` simulări. Pentru card real
  trebuie să treci tu prin flow.
- **ANAF production submit** — sandbox e ok, dar production submit are
  nevoie de certificat USB fizic.

### 11.4 Cum îmi dai acces

Cea mai sigură variantă:
1. Pune credențialele într-un chat privat (nu le pune în GitHub issues!).
2. După ce termin de testat, **șterge userul** `claude@amass.ro` sau
   schimbă-i parola.
3. Activează **rate-limit strict** pe IP-ul meu dacă vrei paranoia în plus.

---

## 12. Rollback + troubleshooting

### 12.1 Rollback la versiunea anterioară

```bash
cd /opt/amass

# Ultimele 5 commits pe main
git log --oneline -5

# Rollback la commit X (soft — păstrează DB intactă, revine la codul vechi)
git checkout <commit-sha>
docker compose -f infra/docker-compose.yml build api web ai-worker
docker compose -f infra/docker-compose.yml up -d api web ai-worker

# Dacă o migrație nouă stricat ceva:
docker exec amass-api pnpm prisma migrate resolve --rolled-back <migration_name>
# Apoi rulează manual SQL-ul invers dintr-un backup. NU există `migrate down`.
```

### 12.2 Backup DB

```bash
# Backup zilnic (pune în cron la 03:00)
docker exec amass-postgres pg_dump -U postgres -Fc amass_crm \
  > /opt/backups/amass_$(date +%F).dump

# Restore (pe DB goală)
docker exec -i amass-postgres pg_restore -U postgres -d amass_crm --clean --if-exists \
  < /opt/backups/amass_2026-04-22.dump
```

### 12.3 Probleme frecvente

| Simptom | Cauză probabilă | Fix |
|---|---|---|
| `amass-api` nu pornește, `loadEnv` throw | Secret <32 chars / origin `*` / `minioadmin` default | Regenerează cu `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `prisma migrate deploy` eșuează cu `tenant_id does not exist` | Migrație aplicată pe DB mai veche | Rulează `prisma migrate resolve --applied <pre-migration>` sau restore backup |
| Requesturile cad cu 500 + `RLS violation` | Lipsește `SET LOCAL app.tenant_id` — vreun serviciu ocolește `runWithTenant` | Caută în cod `this.prisma.` direct fără wrap; adaugă `runWithTenant()` sau filtrează manual `tenantId` |
| `ai-worker` consumă 100% CPU și OOM | Whisper `medium`/`large` pe VPS cu <8GB RAM | Downgrade la `small` sau adaugă GPU |
| Caddy nu emite TLS | DNS nu propagat încă / portul 80 blocat | `dig +short api.crm.amass.ro` + `sudo ufw status` |
| 401 infinit loop pe FE | Refresh cookie `amass_rt` nu ajunge la API | Verifică `credentials: 'include'` + origini pe același domeniu |
| Twilio webhook primește 401 | Signature mismatch — `TWILIO_WEBHOOK_BASE_URL` greșit | Trebuie să fie **exact** URL-ul public pe care Twilio îl POST-uie |
| MinIO presigned PUT → 403 | `MINIO_ENDPOINT` intern ≠ cel public | Setează `MINIO_PUBLIC_ENDPOINT=https://files.crm.amass.ro` |
| Whisper `transcription_mode` rămâne `stub` | `WHISPER_MODEL=off` sau `openai-whisper` neinstalat | Vezi §7 |
| Presidio `redaction_mode` rămâne `stub` | `PRESIDIO_ENABLED=false` sau modelul spaCy RO lipsește | `python -c "import spacy; spacy.load('ro_core_news_lg')"` în container |

### 12.4 Loguri utile

```bash
# Top 20 erori din ultima oră pe API
docker logs --since 1h amass-api 2>&1 | grep -E '"level":50|ERROR' | tail -20

# Queue BullMQ — joburi failed
docker exec amass-api pnpm ts-node -e "
  import { Queue } from 'bullmq';
  const q = new Queue('ai-jobs', { connection: { host: 'redis', port: 6379 }});
  q.getFailed(0, 20).then(console.log).finally(() => process.exit());
"

# pgvector health
docker exec amass-postgres psql -U postgres -d amass_crm -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
```

---

## Pași exacți (TL;DR pentru live)

Dacă vrei calea rapidă, fără să citești tot:

```bash
# 1. VPS Ubuntu 22.04 cu 8 GB RAM, ssh-ul configurat.
# 2.
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/olteancristianradu/amass-crm-v2.git /opt/amass && cd /opt/amass
cp .env.example .env
# 3. Editează .env — completează secretele (vezi §3).
# 4.
docker compose -f infra/docker-compose.yml --env-file .env up -d
# 5. DNS A records pentru crm.amass.ro + api.crm.amass.ro + files.crm.amass.ro → IP VPS.
# 6. Editează infra/Caddyfile cu domeniile tale, apoi:
docker compose -f infra/docker-compose.yml restart caddy
# 7.
docker exec amass-api pnpm prisma migrate deploy
curl -X POST https://api.crm.amass.ro/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"amass","tenantName":"Amass","email":"owner@amass.ro","password":"CHANGE_ME_16_chars","fullName":"Cristi"}'
# 8. Deschide https://crm.amass.ro, login, vezi că merge.
# 9. (opțional) Activează Whisper §7 + Presidio §8.
# 10. (opțional) Dă-mi credentialele conform §11 și încep testele.
```
