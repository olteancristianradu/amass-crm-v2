# MANUAL STEPS — Ce trebuie să faci TU manual

Acest document listează tot ce nu poate fi automatizat prin cod.
Parcurge-l o singură dată la setup inițial și ori de câte ori schimbi infrastructura.

---

## 1. Server / VPS

| # | Acțiune | Detalii |
|---|---------|---------|
| 1.1 | Cumpără VPS | Minim 4 vCPU, 8 GB RAM, 100 GB SSD. Recomandat: Hetzner CX31 (~10 EUR/lună) sau DigitalOcean Droplet. Ubuntu 24.04 LTS. |
| 1.2 | DNS | Adaugă A-record `crm.amass.ro → IP` și (opțional) `api.amass.ro → IP` la registrarul de domeniu. |
| 1.3 | Instalează Docker + Docker Compose | `curl -fsSL https://get.docker.com | sh` + `apt install docker-compose-plugin` |
| 1.4 | Instalează pnpm + Node 22 | `curl -fsSL https://fnm.vercel.app/install | bash && fnm use 22 && npm i -g pnpm` |
| 1.5 | Firewall | Permite porturile 22 (SSH), 80, 443. Blochează 5432, 6379, 9000 (Postgres, Redis, MinIO) din exterior. |

---

## 2. Fișierul `.env` (backend)

Copiază `apps/api/.env.example` → `apps/api/.env` și completează:

```env
# --- Obligatoriu ---
DATABASE_URL=postgresql://crm_user:PAROLA_SECRETA@localhost:5432/amass_crm
REDIS_URL=redis://localhost:6379

JWT_SECRET=           # openssl rand -hex 64
SESSION_SECRET=       # openssl rand -hex 64

MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=     # alegi tu
MINIO_SECRET_KEY=     # openssl rand -hex 32
MINIO_BUCKET=amass-crm
MINIO_USE_SSL=false

# --- Twilio (apeluri telefonice) ---
TWILIO_ACCOUNT_SID=   # din console.twilio.com
TWILIO_AUTH_TOKEN=    # din console.twilio.com
TWILIO_PHONE_NUMBER=  # numărul cumpărat din Twilio (ex: +40...)

# --- Email (SendGrid sau SMTP propriu) ---
SENDGRID_API_KEY=     # din app.sendgrid.com → API Keys
EMAIL_FROM=noreply@amass.ro

# --- Sentry (monitorizare erori) ---
SENTRY_DSN=           # din sentry.io → Projects → amass-crm → DSN

# --- Opțional: AI worker ---
OPENAI_API_KEY=       # pentru embeddings (text-embedding-3-small)
ANTHROPIC_API_KEY=    # pentru rezumate Claude (claude-sonnet-4-6)
```

---

## 3. Baza de date Postgres

```bash
# Creează userul și DB-ul (o singură dată)
psql -U postgres -c "CREATE USER crm_user WITH PASSWORD 'PAROLA_SECRETA';"
psql -U postgres -c "CREATE DATABASE amass_crm OWNER crm_user;"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE amass_crm TO crm_user;"

# Activează extensiile necesare
psql -U crm_user -d amass_crm -c "CREATE EXTENSION IF NOT EXISTS pgvector;"
psql -U crm_user -d amass_crm -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# Rulează migrările Prisma
cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
```

---

## 4. MinIO (stocare fișiere)

```bash
# Pornire container (sau instalare nativă)
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=ACCES_KEY \
  -e MINIO_ROOT_PASSWORD=SECRET_KEY \
  -v /data/minio:/data \
  quay.io/minio/minio server /data --console-address ":9001"

# Creează bucket-ul din consola MinIO: http://IP:9001
# Bucket name: amass-crm
# Access: Private
```

---

## 5. Twilio (telefonie)

| # | Acțiune |
|---|---------|
| 5.1 | Creează cont pe [twilio.com](https://twilio.com) |
| 5.2 | Cumpără număr de telefon românesc sau internațional cu capacitate Voice |
| 5.3 | Setează Webhook URL pentru apeluri incoming: `https://api.amass.ro/api/v1/calls/twilio/incoming` |
| 5.4 | Setează Webhook URL pentru status callbacks: `https://api.amass.ro/api/v1/calls/twilio/status` |
| 5.5 | Copiază `TWILIO_ACCOUNT_SID` și `TWILIO_AUTH_TOKEN` în `.env` |

---

## 6. Email — SendGrid

| # | Acțiune |
|---|---------|
| 6.1 | Creează cont pe [sendgrid.com](https://sendgrid.com) |
| 6.2 | Verifică domeniu: Settings → Sender Authentication → Domain Authentication → `amass.ro` |
| 6.3 | Adaugă DNS records SendGrid (DKIM, SPF) la registrarul de domeniu |
| 6.4 | Generează API Key cu permisiuni `Mail Send` → copiază în `.env` |

---

## 7. Caddy (reverse proxy + HTTPS automat)

```bash
# Instalare
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
echo "deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/debian.bookworm main" | tee /etc/apt/sources.list.d/caddy.list
apt update && apt install caddy
```

Fișier `/etc/caddy/Caddyfile`:

```
crm.amass.ro {
  reverse_proxy localhost:3001   # frontend (Vite preview sau static)
}

api.amass.ro {
  reverse_proxy localhost:3000   # NestJS API
}
```

```bash
systemctl enable --now caddy
```

---

## 8. Primul tenant + utilizator OWNER

```bash
# Rulează seed-ul (creează tenant + owner + pipeline default)
cd apps/api
pnpm prisma db seed

# SAU, dacă nu există seed script, rulează direct:
curl -X POST https://api.amass.ro/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@amass.ro","password":"PAROLA","firstName":"Admin","lastName":"AMASS","tenantName":"AMASS SRL"}'
```

---

## 9. GitHub Actions — Secrets CI/CD

În GitHub → repo → Settings → Secrets and variables → Actions, adaugă:

| Secret | Valoare |
|--------|---------|
| `DATABASE_URL` | string-ul de conexiune Postgres de test |
| `REDIS_URL` | `redis://localhost:6379` (sau serviciu separat) |
| `JWT_SECRET` | orice string lung random |
| `SESSION_SECRET` | orice string lung random |

---

## 10. Sentry (monitorizare erori în producție)

| # | Acțiune |
|---|---------|
| 10.1 | Creează cont pe [sentry.io](https://sentry.io) |
| 10.2 | Creează proiect: Platform = Node.js / NestJS |
| 10.3 | Copiază DSN-ul în `.env` ca `SENTRY_DSN` |
| 10.4 | (Opțional) Creează proiect React separat pentru frontend |

---

## 11. Backup automat Postgres

```bash
# Creează script /usr/local/bin/pg-backup.sh
cat > /usr/local/bin/pg-backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U crm_user amass_crm | gzip > /backups/amass_crm_$DATE.sql.gz
find /backups -name "*.sql.gz" -mtime +30 -delete
EOF
chmod +x /usr/local/bin/pg-backup.sh
mkdir -p /backups

# Adaugă la crontab (backup zilnic la 02:00)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/pg-backup.sh") | crontab -
```

---

## 12. Variabile de mediu Frontend

Copiază `apps/web/.env.example` → `apps/web/.env`:

```env
VITE_API_URL=https://api.amass.ro/api/v1
VITE_SOCKET_URL=https://api.amass.ro
VITE_SENTRY_DSN=   # opțional, DSN frontend Sentry
```

---

## 13. Checklist final înainte de launch

- [ ] DNS propagat (verifică cu `dig crm.amass.ro`)
- [ ] HTTPS funcționează (Caddy a obținut certificat Let's Encrypt)
- [ ] `POST /auth/register` returnează token valid
- [ ] Upload fișier → MinIO → presigned URL funcționează
- [ ] Apel test Twilio → webhook primit
- [ ] Email test trimis și recepționat
- [ ] Backup script rulat manual o dată
- [ ] Sentry primește erori test (`throw new Error('test')` temporar)
- [ ] `pnpm lint && pnpm test` → toate trec pe CI

---

*Generat automat de Claude Code — actualizează după fiecare sprint major.*
