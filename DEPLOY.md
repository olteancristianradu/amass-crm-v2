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
