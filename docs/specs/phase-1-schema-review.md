# Phase 1 — Schema Review (Email Tracking + Campaign Builder + Webhooks)

> Reviewer: `database-architect` · Generated 2026-05-17 · Branch `main` @ `bee04c6` (1.0.0-rc.2)
> Verdict: **APPROVE WITH CHANGES** (5 conditions — see Concerns)

## TL;DR

Phase 1 features ALREADY HAVE most models in schema. Naming conflicts vs ROADMAP_V2 proposals — reuse existing models:

| ROADMAP proposed | Actual existing | Decision |
|---|---|---|
| `EmailCampaign` | `Campaign` (multi-channel, `schema.prisma:2273`) | EXTEND (add subject, templateJson, scheduling, counters) |
| `EmailEvent` | `EmailTrack` (`schema.prisma:815`) | EXTEND (add BOUNCE/UNSUB/SPAM kinds + recipient FK) |
| `WebhookSubscription` | `WebhookEndpoint` (`schema.prisma:1944`) | EXTEND (add encrypted secret, idempotency) |
| `WebhookDelivery` | `WebhookDelivery` (`schema.prisma:1960`) | EXTEND (add nextAttemptAt, deadLetter, durationMs) |
| (none) | (none) | NEW `CampaignRecipient` (per-recipient HMAC tracking) |
| (none) | (none) | NEW `EmailSuppression` (GDPR hash-based bounce/unsub list) |

## 5 migrations (split per ALTER TYPE rule)

Postgres restriction: `ALTER TYPE ... ADD VALUE` cannot run inside transaction → must be in **separate** migration from columns/indexes that depend on it.

| # | Migration | Type | Splits |
|---|---|---|---|
| A | `20260518100000_phase1_campaign_builder_enums` + `20260518100100_phase1_campaign_builder_columns` | Extend Campaign | 2 files (enums + columns) |
| B | `20260518110000_phase1_campaign_recipients` | NEW table | 1 file |
| C | `20260518120000_phase1_email_tracks_enums` + `20260518120100_phase1_email_tracks_columns` | Extend EmailTrack | 2 files |
| D | `20260518130000_phase1_email_suppressions` | NEW table | 1 file |
| E | `20260518140000_phase1_webhooks_enums` + `20260518140100_phase1_webhooks_columns` | Extend Webhook | 2 files |

Total: **7 SQL migration files** across 5 logical groups.

## Key schema additions

### Campaign extends (Migration A)
- `subject VARCHAR(998)`, `fromName`, `fromAddress`, `replyTo`
- `templateJson Jsonb` (block-based schema)
- `templateHtml VARCHAR(1048576)`, `templateText VARCHAR(262144)`, `previewText VARCHAR(255)`
- `scheduledAt`, `sentAt`, `recipientFilter Jsonb`, `recipientCount`
- Counters: `openCount`, `uniqueOpenCount`, `clickCount`, `uniqueClickCount`, `bounceCount`, `unsubscribeCount`, `spamReportCount`, `sentSuccessCount`, `sentFailureCount`
- New `CampaignStatus`: `SCHEDULED`, `SENDING`, `CANCELLED` added to enum
- CHECK constraint: EMAIL channel requires (subject, fromAddress, templateHtml) before status moves out of DRAFT/PAUSED/CANCELLED
- Partial index `campaigns_scheduler_pending_idx` ON (tenantId, scheduledAt) WHERE status='SCHEDULED' — keeps index tiny for worker hot path

### CampaignRecipient (Migration B — NEW)
Per-recipient tracking with unique HMAC token. Required because existing `EmailTrack` doc-comment recognizes per-recipient attribution gap (`schema.prisma:811-814`).
- `id, tenantId, campaignId (FK CASCADE), subjectType, subjectId, email, trackingToken UNIQUE`
- `status CampaignRecipientStatus` (PENDING/QUEUED/SENT/DELIVERED/BOUNCED/FAILED/SKIPPED)
- Lifecycle timestamps + per-recipient counters
- New `SubjectTypeExt` enum (NOT modifying global `SubjectType`!) = COMPANY/CONTACT/CLIENT/LEAD
- 3 indexes: (tenantId, campaignId, status) worker batch, (tenantId, subjectType, subjectId) timeline, (tenantId, email) suppression check
- Unique (campaignId, subjectType, subjectId) prevents duplicate sends
- RLS canonic pattern

### EmailTrack extends (Migration C)
- New enum values: `BOUNCE`, `UNSUBSCRIBE`, `SPAM_REPORT`, `DELIVERED`
- `messageId` becomes NULLABLE (event can originate from campaign without specific message)
- New columns: `recipientId` (FK CampaignRecipient), `bounceType`, `bounceCode`, `piiHashedAt`
- CHECK constraint: `message_id IS NOT NULL OR recipient_id IS NOT NULL`
- 3 new indexes including partial `email_tracks_pii_pending_idx` for GDPR anonymization scan

### EmailSuppression (Migration D — NEW)
GDPR-compliant: hash-based, no plaintext PII stored.
- `id, tenantId, emailHash (SHA-256 lowercase), emailMasked, reason, source, addedAt, expiresAt`
- Enum `EmailSuppressionReason`: USER_UNSUBSCRIBE, BOUNCE_HARD, SPAM_REPORT, MANUAL_ADD, COMPLAINT, GLOBAL_BLOCK
- Justifică: GDPR Art. 17 requires PII deletion but CAN-SPAM §5(a)(4) + EU best-practice require persistent unsubscribe → hash as pseudonym solves both
- RLS canonic + unique (tenantId, emailHash)

### WebhookEndpoint + WebhookDelivery extends (Migration E)
- WebhookEvent enum: +7 values (CAMPAIGN_SENT, CAMPAIGN_COMPLETED, EMAIL_OPENED, EMAIL_CLICKED, EMAIL_BOUNCED, EMAIL_UNSUBSCRIBED, EMAIL_SPAM_REPORTED)
- WebhookEndpoint adds: `secretEncrypted` + `secretKid` (envelope encryption KMS), `description`, `consecutiveFailures`, `lastDeliveryAt`, `lastSuccessAt`, `disabledAt`, `disabledReason`, `createdById`
- WebhookDelivery adds: `payloadHash`, `idempotencyKey`, `signature`, `signatureKid`, `responseHeaders`, `maxAttempts` (default 8), `nextAttemptAt`, `deadLetter`, `durationMs`, `completedAt`
- Partial index `webhook_deliveries_retry_pending_idx` ON (nextAttemptAt) WHERE success=FALSE AND deadLetter=FALSE — worker hot path
- CHECK constraint `webhook_endpoints_url_https_chk`: url LIKE 'https://%'
- Partial index `webhook_endpoints_tenant_active_idx` ON (tenantId) WHERE isActive=TRUE

## TENANT_SCOPED_MODELS updates (`apps/api/src/infra/prisma/prisma.service.ts`)
- Add `'CampaignRecipient'` between `'Campaign'` and `'Case'` (alphabetical)
- Add `'EmailSuppression'` between `'EmailSequenceStep'` and `'EmailTrack'`
- Campaign, EmailTrack, WebhookEndpoint, WebhookDelivery — already present (no-op)
- Verify `prisma.service.spec.ts` introspection test still passes (regression guard)

## BLOCKERS (5 conditions before merge)

### Blocker 1: SubjectType global vs SubjectTypeExt
DO NOT modify `SubjectType` global enum (would impact Notes/Attachments/Activities). Instead introduce `SubjectTypeExt` parallel enum for CampaignRecipient that includes LEAD.

### Blocker 2: WebhookEndpoint.secret plaintext (envelope encryption)
3-stage migration plan:
1. **Phase 1.0**: add `secretEncrypted` + `secretKid`, dual-write
2. **Phase 1.5** (30d later): backfill encrypt old rows, stop dual-write
3. **Phase 1.6** (60d later, zero reads from plaintext): DROP COLUMN secret

KMS: AWS KMS or Vault transit. Dev fallback: env-var `WEBHOOK_SECRET_KEK`.

### Blocker 3: ALTER TYPE in transaction
Postgres prevents `ALTER TYPE ... ADD VALUE` in transaction → **must** split migrations into separate enum-only + columns/indexes files. Already enforced in migration list above (7 files for 5 logical migrations).

### Blocker 4: TENANT_SCOPED_MODELS sync
Both new models (CampaignRecipient, EmailSuppression) MUST be added to the Set. Regression test `prisma.service.spec.ts` introspects schema and will fail otherwise.

### Blocker 5: EXPLAIN ANALYZE on seed 100k
Required pre-merge: queries §A.5 + §B.4 must show <5ms p95 on dev DB seeded with 100k rows. NOT just planned — actually run.

## Volume + retention

Worst case: 100 tenants × 4 campaigns/month × 10k recipients × 4-5 events = **~20M EmailTrack rows/month**.

Retention strategy:
1. **PII anonymization 90d** — nightly cron `email-tracks:hash-pii` at 03:00 RO → nullify ip_address+user_agent, set `piiHashedAt=NOW()` (GDPR Art. 5(1)(e) + 17)
2. **Row archival 12mo** — counts cached in Campaign aggregates, DELETE OPEN/CLICK rows after 12mo, KEEP BOUNCE/UNSUB/SPAM_REPORT indefinitely (deliverability reputation)
3. **Cold backup MinIO** before DELETE (~$0.004/GB/mo)
4. **Partitioning trigger** >500M rows → ADR per CLAUDE.md deferred tech protocol

## Concerns (non-blocking, observe)

- **email_tracks ~20M/mo**: monitor `pg_stat_user_tables.n_tup_ins` via Prometheus; if >1000/s sustained → trigger partitioning ADR
- **template_html VARCHAR(1MiB) triggers TOAST**: kicks in >2KB. If UX uses inline editor → DB ok. If import >100KB → migrate to MinIO per CLAUDE.md rule #12 (binaries → MinIO)

## Action items (handoff backend-engineer)

- [ ] 7 migration files per split plan above
- [ ] 2 entries added to `TENANT_SCOPED_MODELS` in `prisma.service.ts`
- [ ] Verify `prisma.service.spec.ts` introspection still green
- [ ] Hash-PII cron job + EmailSuppression lookup in send pipeline (GDPR)
- [ ] EXPLAIN ANALYZE on 6 queries with 100k seed
- [ ] SSRF defense in app layer (CIDR block + DNS rebinding re-check)
- [ ] Envelope encryption for webhook secret (Phase 1.0 additive)
- [ ] Audit `docs/GDPR.md` retention windows

## Verdict: APPROVE WITH CHANGES

Conditional on 5 blockers above. Schema review delivered inline (`database-architect` agent output 2026-05-17), saved here as condensed reference. Full agent output available in session transcript if needed.

## Files referenced
- `apps/api/prisma/schema.prisma` (modeling targets: lines 805, 815, 1296, 1932, 1944, 1960, 2259, 2273)
- `apps/api/src/infra/prisma/prisma.service.ts` (TENANT_SCOPED_MODELS Set lines 14-104)
- `apps/api/prisma/migrations/20260504065000_rls_deny_missing_tenant/migration.sql` (`current_tenant_id()` sentinel pattern)
- `apps/api/prisma/migrations/20260515090000_scim_token/migration.sql` (canonical CREATE TABLE + RLS + GRANT template)
- `docs/threat-models/phase-1.md` (paired threat model)
- `docs/specs/phase-1.md` (paired Gherkin specs)
