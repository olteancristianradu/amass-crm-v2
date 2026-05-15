# Incident Response Runbook

**Per GDPR Art. 33-34: data breach notification to ANSPDCP within 72 hours; notification to data subjects without undue delay if high risk.**

**Per SOC 2 CC7.3: incident response procedures must be documented, tested, and improved.**

Last updated: 2026-04-29 · v1.0

---

## Pre-deploy env check

Run **before every production deploy** (rolling update or first-time bootstrap):

```bash
scripts/check-prod-env.sh --env-file=/opt/amass/.env
```

The script mirrors the Zod schema + `prodOnlyChecks` in
[`apps/api/src/config/env.ts`](../apps/api/src/config/env.ts) — same rules
that crash the API at startup if violated, but surfaced **before** the
rollout begins so the operator can fix `.env` instead of debugging a
half-deployed stack. Exits non-zero on any failure; warnings are advisory.

What it validates (matches `env.ts` exactly):

- **REQUIRED:** `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`
- **PRODUCTION-ONLY:** `NODE_ENV=production`; `AI_WORKER_SECRET` set; MinIO creds not `minioadmin`; `ENCRYPTION_KEY` not all-zeros; JWT secrets ≥32 chars; no `*` in `CORS_ALLOWED_ORIGINS`; `WEBHOOK_TRUSTED_HOSTS` empty; one of `METRICS_ALLOWED_IPS`/`METRICS_AUTH_TOKEN` set
- **RECOMMENDED (warnings only):** `SENTRY_DSN`, `STRIPE_WEBHOOK_SECRET`, `SIEM_WEBHOOK_URL`

### When it's safe to ignore warnings

Warnings (`⚠`) never block; they're advisory:

- **`SENTRY_DSN` unset** — fine on a first deploy or smoke environment;
  wire Sentry before public launch.
- **`STRIPE_WEBHOOK_SECRET` unset** — fine until billing (S51) is enabled.
- **`SIEM_WEBHOOK_URL` unset** — fine if every tenant configures their own
  per-tenant `tenant.siemWebhookUrl` (no central fallback needed).

If the script reports `placeholder values` (e.g. `change-me`, `your-key-here`,
`REPLACE_ME`), STOP — the env file is the template, not the real config.
Regenerate secrets and re-run.

If a new prod check is added to `env.ts` and this script doesn't catch it,
**fix the script** — `env.ts` is the source of truth, but a startup-time
crash is too late.

---

## 1. Severity classification

| Level | Definition | Response time | Notification |
|---|---|---|---|
| **P0 — CRITICAL** | Active data breach, total outage, cross-tenant data leak confirmed | Immediate (within 15 min) | All hands; ANSPDCP within 72h; affected data subjects |
| **P1 — HIGH** | Single-tenant breach, partial outage >30 min, security control failure | Within 1 hour | On-call; CEO; affected tenant(s) |
| **P2 — MEDIUM** | Minor security finding, performance degradation, near-miss | Within business day | On-call |
| **P3 — LOW** | Cosmetic bug, documentation gap, observability gap | Backlog | Tracked in TODOS.md |

---

## 2. Detection sources

Incidents may be detected via:

1. **Sentry** — uncaught exceptions, error spikes (>10× baseline within 5 min)
2. **Prometheus + Grafana** — latency p95 > 1s, error rate > 1%, queue depth > 1000
3. **Audit log anomaly** — unusual cross-tenant access attempts, repeated 403s, mass DELETE
4. **External report** — customer email, security researcher (security@amass-crm.ro)
5. **Routine /cso scan** — finds during periodic security review
6. **SIEM webhook** — when forwarded to tenant's own SOC

---

## 3. Response procedure

### Phase 1: TRIAGE (target: <15 min for P0/P1)

1. **Acknowledge** the alert (suppress duplicate notifications)
2. **Classify** severity using the table above
3. **Open** an incident ticket: title format `[YYYY-MM-DD] PN — short description`
4. **Notify**:
   - P0: WhatsApp/SMS + email + phone call to founder + on-call
   - P1: Slack/email to on-call within 5 min
   - P2/P3: Email to backlog inbox
5. **Assemble responders**: minimum one engineer + one decision-maker

### Phase 2: CONTAIN (target: <1 hour for P0)

1. **Stop the bleeding** without destroying evidence:
   - For credential leak: revoke compromised tokens via `auth/revoke`
   - For active exfiltration: block source IP via Cloudflare WAF
   - For app-level vulnerability: deploy hotfix or feature-flag the affected code path off
   - For database compromise: rotate DB password, kill suspicious sessions
2. **Preserve evidence**:
   - Snapshot Postgres at point-in-time (Railway/Hetzner backup)
   - Export relevant audit_logs to a separate location
   - Capture Cloudflare WAF logs for the incident window
   - DO NOT delete anything — investigation needs the trail
3. **Document** every action taken with timestamp

### Phase 3: INVESTIGATE (target: ongoing, until root cause known)

1. **Scope assessment**:
   - Which tenants affected?
   - Which personal data fields exposed?
   - Time window of exposure?
   - Who/what accessed the data?
2. **Root cause analysis** using audit log + application logs:
   - What was the entry point?
   - What controls failed?
   - Why didn't earlier defenses catch it?
3. **Variant analysis**: are there other instances of the same vulnerability pattern?

### Phase 4: NOTIFY (regulatory + customer)

#### 4.1 If personal data WAS breached

**ANSPDCP notification (within 72h of awareness, per Art. 33):**

Submit form via https://www.dataprotection.ro/?page=Notificare_breach with:
- Nature of breach + categories + approximate number of data subjects + records concerned
- Likely consequences of the breach
- Measures taken or proposed to address it and mitigate adverse effects
- Name and contact details of the DPO or other contact point

**Affected data subjects (without undue delay if HIGH risk to rights, per Art. 34):**

Email template skeleton in Appendix A. Required content:
- Description of the nature of the breach
- Name and contact of DPO/contact point
- Likely consequences
- Measures taken/proposed to address it
- Recommendations for the data subject (e.g., reset password, monitor accounts)

**EXEMPTIONS to data subject notification (Art. 34(3)):**
- Encrypted data with intact key (key not compromised)
- Subsequent measures rendered breach unlikely to result in high risk
- Disproportionate effort: public communication acceptable instead

#### 4.2 If personal data was NOT breached (but incident still happened)

- Notify affected tenants via in-app banner + email if their service was disrupted
- Update status page (when public status page is built)

### Phase 5: RECOVER (full service restoration)

1. **Verify** the fix is deployed AND working in production
2. **Confirm** all defenses re-engaged
3. **Monitor** for 24-48h post-incident for re-occurrence or related anomalies
4. **Restore** any data lost from backups (with PITR if needed)
5. **Communicate** "all clear" to stakeholders

### Phase 6: LEARN (postmortem within 7 days)

Write a postmortem in `docs/postmortems/YYYY-MM-DD-<slug>.md` covering:

- **Timeline** (UTC, all key events)
- **Impact** (who, what, how long)
- **Root cause(s)** — technical + organizational (5-Why)
- **What went well**
- **What went poorly**
- **Action items** (owner + deadline) — SHIP these
- **Lessons** added to `LESSONS.md`

Postmortem must be **blameless** — focus on systems and processes, not individuals.

---

## 4. Specific scenarios with playbooks

### 4.1 Leaked secret in git history

1. **Revoke** the credential immediately at the issuing service (Stripe, AWS, etc.)
2. **Rotate** — generate a new credential
3. **Scrub git history** — `git filter-repo` or BFG Repo-Cleaner
4. **Force-push** the cleaned history (coordinate with all collaborators)
5. **Audit exposure**: when committed? When removed? Was repo public during that window?
6. **Check provider's logs** for any abuse of the leaked credential
7. **Rotate dependent secrets** if the leaked one was used to encrypt others

### 4.2 SQL injection (defense-in-depth failure)

1. Identify the injection point (usually Prisma `$queryRawUnsafe` — banned by CLAUDE.md rule #13)
2. Patch with parameterized query
3. Audit all `$queryRaw*` and `executeRaw*` usages for similar patterns (variant analysis)
4. Add lint rule blocking `$queryRawUnsafe` in pre-commit hook

### 4.3 Cross-tenant data exposure

This is THE worst-case scenario for AMASS-CRM. Defense in depth (3 layers) is designed to make this impossible.

1. **Immediately disable** the affected endpoint via feature flag if isolatable
2. **Determine** which layer failed:
   - Layer 1 (middleware): TenantContextMiddleware bypass?
   - Layer 2 (Prisma extension): missing `runWithTenant`?
   - Layer 3 (RLS): policy mistake or app_user grant escalation?
3. **Audit** all queries done in the affected window — list cross-tenant access in audit_logs
4. **Notify each affected tenant** within 24h (more aggressive than 72h regulatory minimum)
5. Consider **offering credit / extension** for trust restoration
6. **Write detailed postmortem** — this is reputational + legal critical

### 4.4 Compromised JWT signing key

1. **Rotate JWT_SECRET** immediately
2. All existing access tokens become invalid (will fail jwt.verify)
3. All users forced to re-login
4. Refresh tokens stay valid (separate cookie) — but next refresh will sign with new key
5. Monitor for repeated 401s spike — expected for ~30 min as caches expire

### 4.5 Webhook outbound abused for SSRF

Already mitigated: `webhooks.service.ts:135` re-validates URL via `validateUrl()` before each delivery (DNS rebinding defense). Residual TOCTOU window is microseconds — accepted risk.

If exploited despite this:
1. Disable webhook delivery globally (env: `WEBHOOKS_DISABLED=true` — TODO: implement)
2. Audit `webhookDeliveries.responseBody` for last 30 days for internal IPs / metadata service responses
3. Patch the gap (likely add IP pinning at fetch time)

---

## 5. Drills and testing

This runbook is **untested theater** unless we drill it.

### Quarterly drill

Pick one scenario at random. Run through it end-to-end with a colleague (or solo if no team yet). Time each phase. Find what's missing in the runbook. Update the runbook.

### Annual tabletop

External party (security consultant or trusted advisor) walks through 2-3 scenarios with the team. Record gaps. Add to runbook.

---

## Database Restore

Restoring from a Postgres backup is irreversible — running it **drops the
target database** and recreates it from a `pg_dump` archive. Use only when:

1. Production data corruption is confirmed (not just suspected), OR
2. A successful restore drill is being practiced against a staging DB, OR
3. A point-in-time rollback has been approved by the incident commander.

The backup pipeline is documented in [`docs/SCALING.md#backups`](./SCALING.md#backups).

### Prerequisites

- **S3 credentials** with read access to `s3://${BACKUP_BUCKET}/db/` (the
  same values used by the `db-backup` service: `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_BUCKET`).
- **Postgres connection** to the target instance (`PGHOST`, `PGUSER`,
  `PGPASSWORD`, `PGDATABASE`). The user needs `CREATEDB` + ownership of
  the target DB so `dropdb` + `createdb` succeed.
- **The `db-backup` image** built locally (so we get `mc` +
  `postgresql16-client` + the script in one shot). The compose `run --rm`
  invocation below builds it on demand.
- **All API/web containers stopped** (so writes don't race the restore):
  `docker compose stop api web ai-worker`.

### Step-by-step

1. **Stop traffic to the DB.**

   ```
   docker compose \
     -f infra/docker-compose.yml \
     -f infra/docker-compose.prod.yml \
     --env-file .env.production \
     stop api web ai-worker
   ```

2. **Run the restore script interactively** (it will list the last 30
   dumps and ask which one to restore). The `--confirm-i-want-to-destroy-prod`
   flag is mandatory — the script refuses to run without it.

   ```
   docker compose \
     -f infra/docker-compose.yml \
     -f infra/docker-compose.prod.yml \
     --env-file .env.production \
     run --rm \
       --entrypoint /usr/local/bin/restore-db.sh \
       db-backup \
       --confirm-i-want-to-destroy-prod
   ```

   The script will also prompt you to **type the database name** as a
   second safety gate before running `dropdb`.

3. **Non-interactive variant** (if you already know which dump):

   ```
   docker compose ... run --rm \
       --entrypoint /usr/local/bin/restore-db.sh \
       db-backup \
       --confirm-i-want-to-destroy-prod \
       --file 2026-05-15_020000.dump
   ```

   The `--file` flag accepts a bare filename (resolved against
   `s3://${BACKUP_BUCKET}/db/`), a `backup/...` alias path, or an
   absolute local path inside the container.

4. **Restart the app**:

   ```
   docker compose ... up -d api web ai-worker
   ```

### Expected duration

- **<1 GB dump:** ~5 minutes (network-bound).
- **1–5 GB dump:** ~10–15 minutes.
- **5–50 GB dump:** ~20–60 minutes (`pg_restore` is single-threaded by
  default — pass `--jobs=N` inside the script for parallel restore if we
  ever hit this size; not done today because v1 DB is well under 5 GB).

### Verification

Run from inside the Postgres container (or any psql-equipped host):

```
psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  -c 'SELECT count(*) FROM tenants;' \
  -c 'SELECT count(*) FROM users;' \
  -c 'SELECT count(*) FROM deals;' \
  -c "SELECT MAX(\"createdAt\") FROM audit_logs;"
```

- `tenants` row count should match the expected production headcount
  (record this value somewhere before restore).
- `audit_logs` MAX createdAt should be close to the dump's timestamp
  (any later writes were lost — that's the gap you need to communicate
  to affected tenants per Phase 4 above).

If any count is suspiciously low (e.g., 0), **stop, do NOT restart the
app**, and re-pick an older dump.

### Post-restore checklist

- [ ] Audit log entry recorded with operator name + dump filename + reason
- [ ] Affected tenants notified about the data gap (everything written
      between dump time and restore time is gone)
- [ ] Sentry release marker added so error timeline shows the rollback
- [ ] Postmortem written within 7 days (per Phase 6)

---

## Rolling update + Rollback

Two scripts live in `scripts/`:

- `update-vps.sh` — **routine rolling update.** Use for every normal
  deploy. Automatically takes a pre-update DB backup, applies migrations
  against the new image, recreates `api`/`web`/`ai-worker`, waits for
  `/api/v1/health` to return 200, and **auto-rolls-back on any failure**.
- `rollback-vps.sh` — **manual, deliberate rollback** to a specific SHA
  or branch. Use when auto-rollback didn't run (host crash, manual
  abort, planned revert after the deploy looked healthy). Asks you to
  re-type the target SHA as a confirm gate.

### When to use which

| Situation | Script | Notes |
|---|---|---|
| Normal deploy of latest `main` | `update-vps.sh` | Auto-backup + auto-health + auto-rollback all built in. |
| Emergency hot-fix when backup pipeline is broken | `update-vps.sh --skip-backup` | Logs a loud warning. **Do NOT use** if the new code might run a schema-changing migration — you'd lose the safety net. |
| Deploy a non-`main` branch (staging, hotfix branch) | `update-vps.sh --branch=NAME` | Same safety guarantees as main. |
| Revert to an older SHA after a deploy went bad | `rollback-vps.sh --to <SHA>` | Confirm prompt. Does **not** take a backup — the bad code is already in prod. |
| Disaster-recovery (data corrupted, restore from dump) | See **Database Restore** above | Code rollback alone won't fix data drift. |

### Routine deploy procedure

On the VPS as root:

```
/opt/amass/scripts/update-vps.sh
```

The script runs six phases (each line is timestamp-prefixed in the log):

```
PHASE-0 preflight        verify perms / repo / docker / capture ROLLBACK_SHA
PHASE-1 db-backup        docker compose run --rm db-backup → blocking
PHASE-2 fetch+build      git fetch + checkout + build api/web/ai-worker
PHASE-3 migrate          prisma migrate deploy in a one-shot container
                          using the NEW image
PHASE-4 recreate+health  docker compose up -d + poll /api/v1/health up
                          to 60s (30 × 2s)
PHASE-5 rollback         (only fires on failure) checkout ROLLBACK_SHA,
                          rebuild, recreate, re-health, warn about DB drift
PHASE-6 report           docker compose ps + git log + elapsed time
```

If everything is already up to date, the script exits cleanly after PHASE-2.

### `--skip-backup`: when to use it (and when NOT to)

**Use it only when:**
- The backup pipeline itself is broken AND you have a code fix in `main`
  that restores it.
- You have **independently verified** there is a recent backup (manual
  `pg_dump` from minutes ago, or a verified S3 dump less than ~1 hour old).
- The diff has **no schema-changing migration** (`prisma/migrations` is
  untouched relative to `origin/main`).

**Do NOT use it when:**
- Backups are fine but you "just want it faster" — the backup is a few
  minutes; the recovery if a migration corrupts data is hours-to-days.
- The PR contains a Prisma migration. A failed schema change with no
  pre-backup leaves you choosing between rolling forward through
  corruption and restoring from a stale nightly dump.

### Auto-rollback (PHASE 5) — what it does and doesn't

When **any** of PHASE-1 backup / PHASE-3 migrate / PHASE-4 health fails:

1. `git checkout ROLLBACK_SHA` (the SHA captured in PHASE-0).
2. `docker compose build api web ai-worker` — fast cache-friendly rebuild.
3. `docker compose up -d --force-recreate api web ai-worker`.
4. Re-run the same `/api/v1/health` poll. Logs success or pages the operator.

What it explicitly does **not** do:

- **Migrations are not reverted.** Prisma `migrate deploy` is one-way. If
  the failed phase was PHASE-3 or PHASE-4 (i.e. migrations may have been
  applied), the script prints a big banner instructing you to restore
  from the PHASE-1 backup using **Database Restore** above.
- **No notification dispatch.** Slack / Sentry alerting is a separate
  layer. Watch the deploy log live (`tail -f` or run interactively).

### Manual rollback procedure (if auto-rollback fails)

If you see "rollback build FAILED" or "rollback health-check FAILED" in
the log, the automated path gave up. On the VPS as root:

```
# 1. Confirm the SHA you want to roll back to (from the failure log,
#    or by running `git -C /opt/amass log --oneline -5`).
SHA=abc1234

# 2. Use the manual rollback script — it has its own confirm prompt
#    and health check.
/opt/amass/scripts/rollback-vps.sh --to "$SHA"

# 3. If THAT also fails (image pull errors, disk full, etc.):
cd /opt/amass
git checkout "$SHA"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  --env-file .env.production \
  build api web ai-worker
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  --env-file .env.production \
  up -d --force-recreate api web ai-worker
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \
  --env-file .env.production \
  logs --tail=50 api
```

### DB rollback caveat

`update-vps.sh` and `rollback-vps.sh` only touch **code + containers**.
Prisma migrations are **forward-only** — a migration that drops a column,
renames a table, or changes a type cannot be auto-reverted, and rolling
back the code without rolling back the schema will throw `column does
not exist` / `relation does not exist` errors at runtime.

The contract is:

- PHASE 1 takes a backup BEFORE migrations apply.
- If the rolled-back code can't read the current schema, restore from
  that backup via the **Database Restore** procedure above.
- Communicate the data gap (everything written between backup time and
  restore time is gone) to affected tenants, same as a normal DR
  restore.

### Verification after a successful update

The PHASE-6 report shows `docker compose ps` + the list of commits
applied + elapsed time. Sanity checks worth running after:

```
# 1. Health endpoint returns 200 with the expected build SHA.
curl -fsS https://api.crm.<your-domain>/api/v1/health | jq .

# 2. No api container restart loops in the last 5 minutes.
docker compose -f /opt/amass/infra/docker-compose.yml \
  -f /opt/amass/infra/docker-compose.prod.yml \
  --env-file /opt/amass/.env.production \
  ps api web ai-worker

# 3. Migrations match what `main` has on disk.
docker exec amass-api pnpm --filter @amass/api exec prisma migrate status
```

---

## Appendix A: Email template — data subject notification

```
Subject: Important security notice regarding your data

Dear [name],

On [date], we detected a security incident involving the AMASS-CRM service
that may have affected your personal data.

What happened:
[1-2 sentence factual description]

What data may have been involved:
[List exactly: name, email, phone, etc.]

What we have done:
[Concrete actions: contained the breach, rotated credentials, deployed fixes,
notified ANSPDCP]

What you should do:
[Specific recommendations: change your password, review recent activity, etc.]

We deeply regret this incident. If you have questions, please contact our
Data Protection Officer at privacy@amass-crm.ro.

Sincerely,
[Founder]
AMASS-CRM
```

## Appendix B: Contact list

| Role | Contact |
|---|---|
| Founder / CEO (incident commander) | Cristian Radu Oltean — cristian.raduoltean@gmail.com / +40 [phone] |
| ANSPDCP | https://www.dataprotection.ro · anspdcp@dataprotection.ro · +40 31 805 9211 |
| Hosting provider — Railway | https://railway.com/help · support@railway.com |
| External legal counsel | TBD — engage before Faza 2 launch |

---

## Appendix C: Postmortem template

```markdown
# Postmortem: <short title>

**Date of incident:** YYYY-MM-DD HH:MM UTC
**Date of postmortem:** YYYY-MM-DD
**Severity:** P0 / P1 / P2
**Authors:** <names>

## Summary

[2-3 sentence what happened, who was affected, total impact]

## Timeline (all UTC)

- HH:MM — [event]
- HH:MM — [event]

## Impact

- [Who was affected, how many, what data, duration]

## Root cause

[5-Why analysis: technical + organizational]

## What went well

- [Things to keep doing]

## What went poorly

- [Things to fix in process / tools]

## Action items

| Owner | Action | Deadline |
|---|---|---|
| | | |

## Lessons (added to LESSONS.md)

- [Specific learnings transferable to other situations]
```

