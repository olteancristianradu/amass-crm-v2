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
