# LAUNCH_CHECKLIST.md
# Citește înainte de launch / go-live.

> Creat după S13 (2026-04-13). Ultima actualizare majoră: 2026-04-22
> (reconcilat cu STATUS.md după auditul extern).
>
> **Relația cu [STATUS.md](./STATUS.md):**
> - **STATUS.md** = ce EXISTĂ și merge astăzi (cod implementat, teste verzi).
> - **LAUNCH_CHECKLIST.md** = ce NU A FOST verificat încă runtime pe Docker
>   real (smoke tests, RLS per tabelă în producție, chei `.env.production`).
> Nu există declarații contradictorii: dacă STATUS.md spune „funcțional", codul
> trece typecheck + lint + unit tests. Ce adaugă acest checklist e validarea
> pe mediu real (Docker up, migrații aplicate, RLS active, webhook-uri externe
> răspund).
>
> **Workflow:** parcurge fiecare secțiune în ordine. Bifează `[x]` pe măsură
> ce termini. Nu declara aplicația gata până nu sunt bifate toate punctele
> din §1 (critice) și §2 (majore).

---

## §1 — CRITICE (blochează launch-ul)

### 1.1 Validare runtime S12 + S13 pe Docker real
Codul S12/S13 a fost scris și typecheckat dar **niciodată rulat contra un DB
real**. Primul `docker compose up` este momentul adevărului.

- [ ] `docker compose -f infra/docker-compose.yml --env-file .env up -d`
- [ ] Verifică `docker ps` — toate serviciile healthy (postgres, redis, minio, api, ai-worker)
- [ ] `docker logs amass-api` — fără erori la boot (în special env validation errors)
- [ ] `docker logs amass-ai-worker` — BullMQ worker pornit, fără ImportError
- [ ] Aplică migrația S12:
  ```bash
  docker exec amass-api npx prisma migrate deploy
  ```
  Verifică că `phone_numbers`, `calls`, `call_transcripts` există în DB.
- [ ] Verifică RLS pentru tabelele noi:
  ```sql
  SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables
  WHERE tablename IN ('phone_numbers','calls','call_transcripts');
  -- ambele coloane trebuie să fie TRUE
  ```

### 1.2 Smoke test S12 Calls end-to-end
- [ ] `POST /api/v1/phone-numbers` — adaugă un număr Twilio de test
- [ ] `POST /api/v1/calls/initiate` — inițiază un apel outbound
- [ ] Simulează webhook Twilio status (cu semnătură validă sau în dev mode fără):
  ```bash
  curl -X POST "http://localhost:3000/api/v1/calls/webhook/status?callId=<id>" \
    -d "CallStatus=completed&CallDuration=30&CallSid=CAtest"
  ```
  Verifică că statusul din DB devine COMPLETED, `endedAt` e setat.
- [ ] Simulează webhook recording:
  ```bash
  curl -X POST "http://localhost:3000/api/v1/calls/webhook/recording?callId=<id>" \
    -d "RecordingSid=REtest&RecordingUrl=http://example.com/rec"
  ```
  Verifică `transcriptionStatus=PENDING` în DB și job în coada `ai-calls` Redis.
- [ ] Verifică AI callback:
  ```bash
  curl -X POST "http://localhost:3000/api/v1/calls/<id>/ai-result" \
    -H "Authorization: Bearer $AI_WORKER_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"rawText":"test","segments":[{"start":0,"end":1,"text":"test"}]}'
  ```
  Verifică că `call_transcripts` row există și `transcriptionStatus=COMPLETED`.

### 1.3 Smoke test S13 AI Worker
- [ ] `curl http://localhost:8000/health` — răspunde `{"status":"ok","sprint":13}`
- [ ] `POST http://localhost:8000/process/call` cu un `callId` valid și `recordingUrl` gol
  — verifică că se întoarce stub transcript și se face POST callback la API
- [ ] Verifică `docker logs amass-ai-worker` — nicio traceback neașteptată

### 1.4 Twilio signature verification
Dacă `TWILIO_WEBHOOK_BASE_URL` e setat greșit, toate webhook-urile vor fi
respinse cu 403. Verifică exact:
- [ ] `TWILIO_WEBHOOK_BASE_URL` = URL-ul public real (ngrok/cloudflared în dev,
  domeniu real în prod) — **fără slash final**
- [ ] Testează un webhook real din consola Twilio și verifică că nu primești 403
- [ ] Dacă primești 403 în dev și nu ai tunnel, setează temporar
  `TWILIO_AUTH_TOKEN=""` ca să ocolești verificarea (DOAR în dev izolat)

### 1.5 Multi-tenant isolation pentru S12
- [ ] Creează doi tenants distincți (register x2)
- [ ] Adaugă `PhoneNumber` pe tenant A
- [ ] Verifică că `GET /api/v1/phone-numbers` pe tenant B nu îl vede
- [ ] Idem pentru `Call` rows

---

## §2 — MAJORE (afectează UX/funcționalitate core)

### 2.1 Contact detail page — LIPSĂ
Există doar `companies/$id`. Contactele și Clienții au doar pagini de listă.
**Nu ai cum accesa note/timeline/email/apeluri pentru un contact din UI.**

- [x] Creează `apps/web/src/routes/contact.detail.tsx` — același pattern ca
  `company.detail.tsx` cu toate tab-urile (Timeline, Note, Deals, Tasks,
  Remindere, Email, Apeluri, Fișiere)
- [x] Wires route în `apps/web/src/router.tsx`
- [x] Adaugă link pe rândul din `contacts.list.tsx` → `/app/contacts/$id`

### 2.2 Client detail page — LIPSĂ
- [x] Creează `apps/web/src/routes/client.detail.tsx` (același pattern)
- [x] Wires route în router
- [x] Adaugă link pe rândul din `clients.list.tsx` → `/app/clients/$id`

### 2.3 Phone numbers management UI — LIPSĂ
`PhoneNumbersController` există dar nu există pagină web pentru OWNER/ADMIN.
- [x] Creează `apps/web/src/routes/phone-settings.tsx` — CRUD numere Twilio
- [x] Adaugă "Setări telefonie" în sidebar (vizibil doar pentru OWNER/ADMIN)
- [x] Wires în router

### 2.4 CallsTab + EmailTab pe Contact și Client
Ambele tab-uri sunt wired DOAR pe `company.detail.tsx`.
- [x] Adaugă `<CallsTab subjectType="CONTACT" subjectId={id} />` pe contact detail
- [x] Adaugă `<EmailTab subjectType="CONTACT" subjectId={id} />` pe contact detail
- [x] Idem pentru Client (`subjectType="CLIENT"`)

### 2.5 Dashboard — placeholder gol
`/app` afișează probabil "Dashboard" fără conținut.
- [x] Adaugă cel puțin: total companii, contacte, deals open, apeluri azi,
  reminder-uri pending — via `GET /api/v1/...?limit=1` și count queries
- [x] Conectat la S16 Reports (`GET /api/v1/reports/dashboard`)

### 2.6 Notificări vizuale pentru remindere
BullMQ declanșează reminder-ul dar UI-ul nu știe.
- [x] Polling `GET /api/v1/reminders/me?status=FIRED&limit=10` la fiecare 60s
  cu toast notification când apare unul nou față de ultimul poll (seenIds ref)
- [ ] Opțional: implementează WebSocket (Socket.IO e în stack) pentru push real-time
- [ ] Opțional (S20 polish): badge cu numărul de remindere nefiruite în sidebar

### 2.7 E2E tests lipsă pentru S12
- [x] Creează `apps/api/test/calls.e2e.spec.ts`:
  - initiate call (mock TwilioClient.createCall)
  - status webhook happy path (204 + verify via GET)
  - recording webhook (204 + verify via GET)
  - AI result callback → transcript saved (200)
  - cross-tenant isolation on phone numbers
  - unauthenticated 401 pe initiate

---

## §3 — VERIFICĂRI DE SECURITATE

- [ ] **RLS toate tabelele** — rulează query-ul din §1.1 pentru TOATE tabelele
  tenant-scoped (user, company, contact, client, note, attachment, reminder,
  activity, pipeline, pipeline_stage, deal, task, email_account, email_message,
  phone_number, call, call_transcript)
- [ ] **JWT expiry** — access token 15m, refresh 30 zile; verifică că după 15m
  refresh-ul automat din FE funcționează fără logout
- [ ] **ENCRYPTION_KEY rotation** — dacă se schimbă, parolele SMTP stocate sunt
  inutilizabile. Documentează procedura de re-encriptare
- [ ] **AI_WORKER_SECRET** — verifică că endpoint-ul `/calls/:id/ai-result`
  întoarce 403 fără header sau cu secret greșit
- [ ] **Webhook fără semnătură** — cu `TWILIO_AUTH_TOKEN` setat, verifică că
  `/calls/webhook/status` fără header `X-Twilio-Signature` întoarce 403
- [ ] **Presigned URLs** — verifică că un presigned URL de la alt tenant
  nu poate fi folosit de un alt tenant (MinIO path-ul include `tenantId/`)
- [x] **SQL injection** — toate query-urile folosesc Prisma parametrizat,
  NICIUN `$queryRawUnsafe` cu input user. Verificat cu grep 2026-04-14:
  ```bash
  grep -r "queryRawUnsafe\|executeRawUnsafe" apps/api/src/modules/
  # Rezultat: zero matches (doar comentariu în reports.service.ts)
  ```

---

## §4 — VERIFICĂRI DE PERFORMANȚĂ

- [ ] **N+1 queries** — în `list` endpoints cu `include`, verifică că Prisma
  nu face câte un query per rând. Foloseşte `DEBUG="prisma:query"` cu 50+ rânduri
- [ ] **Index-uri** — verifică că query-urile frecvente folosesc index-urile
  definite în schema (ex. `tenantId + subjectType + subjectId + createdAt`)
- [ ] **Pagination** — verifică cursor pagination cu > 1000 rânduri simulat
- [ ] **BullMQ queue depth** — dacă ai multe apeluri simultane, verifică că
  ai-worker procesează la timp (vezi `BULL:ai-calls:waiting` în Redis)

---

## §5 — VERIFICĂRI ÎNAINTE DE DEPLOY (S19)

- [ ] Toate variabilele de mediu din `env.ts` au valori în `.env.production`
- [ ] `ENCRYPTION_KEY` generat fresh pentru prod (nu cel din dev)
- [ ] `JWT_SECRET` și `JWT_REFRESH_SECRET` diferite și ≥32 chars în prod
- [ ] `AI_WORKER_SECRET` generat fresh pentru prod
- [ ] `DATABASE_URL` pointează la Postgres prod cu `app_user` creat și grants aplicate
- [ ] Migrații aplicate în ordine: `prisma migrate deploy`
- [ ] MinIO bucket creat, CORS setat corect pentru presigned URLs
- [ ] Caddy HTTPS activat (elimină `auto_https off` din Caddyfile pentru prod)
- [ ] `TWILIO_WEBHOOK_BASE_URL` = domeniu real de prod (nu ngrok)
- [ ] `WHISPER_MODEL=base` sau `medium` setat pe ai-worker în prod dacă vrei
  transcrieri reale (necesită mai multă RAM/CPU)

---

## §6 — POLISH S20 (după ce §1-§5 sunt bifate)

- [ ] Loading skeletons pe toate listele (în loc de text "Se încarcă…")
- [ ] Empty states ilustrate (în loc de text simplu)
- [ ] Error boundaries în React (în loc de crash alb)
- [ ] Favicon + `<title>` dinamic per pagină
- [ ] Responsive mobile — testează sidebar collapse pe 375px
- [ ] Dark mode (opțional — shadcn/ui suportă via CSS vars)
- [ ] Onboarding flow pentru tenants noi (wizard: adaugă companie → adaugă
  contact → configurează pipeline)
- [ ] Toast notifications consistente (nu doar error-uri)
- [ ] `pnpm build` fără warnings de chunk size (code splitting pentru bundle > 500KB)
- [ ] Accesibilitate de bază: aria-labels pe butoane icon-only, focus ring vizibil

---

## §7 — KNOWN TECH DEBT (documentat, nu blocker)

| Loc | Problemă | Prioritate |
|-----|----------|-----------|
| `calls.service.ts:handleVoiceWebhook` | Inbound calls nu creează Call row (MVP stub) | S20 |
| `calls.service.ts` | `recordingStorageKey` întotdeauna null (nu descarcă în MinIO) | S20 |
| `ai-worker/app/transcription.py` | Whisper dezactivat (stub) | S18/S20 |
| `ai-worker/app/redaction.py` | Presidio dezactivat (regex stub) | S17/S20 |
| `apps/api/test/` | ~~Lipsă e2e pentru calls~~ — calls.e2e.spec.ts adăugat S21; email parțial | S20 |
| `company.detail.tsx` | EmailTab face findAccount în loop (O(n)) | S20 |
| `PrismaService` | Nicio limită de connection pool configurată explicit | S18 |
| `queue.module.ts` | O singură conexiune Redis shared — ok pentru dev, monitorizează în prod | S18 |
| `apps/web` | Bundle > 500KB — necesită code splitting | S20 |
| `AppShell` | Sidebar nu are link pentru Contact detail / Client detail | §2.1 |

---

## §8 — COMANDĂ DE VERIFICARE RAPIDĂ (rulează prima oară)

```bash
# 1. Typecheck toate pachetele
pnpm --filter @amass/api typecheck
pnpm --filter @amass/web typecheck
pnpm --filter @amass/shared typecheck

# 2. Build tot
pnpm --filter @amass/shared build
pnpm --filter @amass/api build
pnpm --filter @amass/web build

# 3. E2e tests (necesită Docker up)
pnpm --filter @amass/api test

# 4. Verifică nicio utilizare de any în codul nou
grep -rn ": any" apps/api/src/modules/ | grep -v ".spec.ts"

# 5. Verifică că toate tabelele au RLS (rulează în psql)
# SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;

# 6. Health checks
curl http://localhost:3000/api/v1/health  # sau /api/v1/auth/me cu token valid
curl http://localhost:8000/health
```

---

*Ultima actualizare: 2026-04-14, după S20/S21.*
*§2 toate bifate. §3 SQL injection bifat. §1, §4, §5 necesită verificare manuală cu Docker real.*
