# Changelog

All notable changes to AMASS CRM are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Phase 2 (closing the deal: contract e-signature + multi-step approvals) — in progress

Phase 2 of ROADMAP_V2 adds in-house contract e-signature (F1) and polymorphic multi-step approval workflows (F2). Backend shipped across commits `d62371d` (schema), `f19c2e8` (F2), `5d91c0d` (F1). E-sign ships behind `CONTRACT_ESIGN_ENABLED=false` plus the `ESIGN_LEGAL_APPROVED` production gate — it stays disabled until the Phase 2.1 remediation below is complete and a lawyer has reviewed the flow.

#### Added — Phase 2

- **Contract e-signature in-house (F1)** — `ContractTemplate` CRUD with a field allow-list, pdfkit PDF generation + MinIO storage, `ContractSigner` ceremony with HMAC-token public sign endpoints, append-only hash-chained `ContractAuditEntry` trail, reminder + expiration crons, and integration with the F2 approval gate.
- **Multi-step approval workflows (F2)** — polymorphic `ApprovalRequest` over QUOTE/CONTRACT/DEAL/INVOICE/EXPENSE, `ApprovalStep` snapshot chain, per-step SLA with cron-driven EXPIRED transitions, self-approval skip, and approver notifications. New `app_worker` Postgres role + append-only DB trigger on `contract_audit_entries`.

#### Fixed — Phase 2.1 patch sprint (post-review remediation, 2026-05-20)

Closes findings raised by `code-reviewer` (BLOCK_MERGE) and `security-red-team` (CRITICAL) — see [`docs/specs/phase-2-review-findings.md`](docs/specs/phase-2-review-findings.md).

- **CRIT-3 / HIGH-6** — `PATCH /contracts/:id` no longer accepts `status`/`signedAt`/`storageKey`; `UpdateContractSchema` is now `.strict()` so they are rejected with 400. Those fields are owned solely by the e-sign ceremony lifecycle — previously a MANAGER/ADMIN/OWNER could rewrite a signed ACTIVE contract back to DRAFT or re-point its MinIO key.
- **CRIT-4** — `ApprovalsService.decide()` authorized role-based steps (`approverId` null) for any authenticated user. It now checks the decider's tenant role against `approverRole` and fails closed on a misconfigured step.
- **CRIT-5 / B-4 / B-5** — `AuditChainService.append()` takes a per-contract `pg_advisory_xact_lock` so concurrent appends cannot fork the hash chain.
- **B-1 / MED-1** — the approval gate recognises an APPROVED request as satisfying its policy — no more infinite-409 retry loop or duplicate requests on subject re-send.
- **B-2 / B-3** — `decide()` defers next-step activation to `advanceUntilHumanStep`, so the next approver is notified and a self-approval next step no longer stalls the chain.

#### Still open before Phase 2 close (tracked in `docs/specs/phase-2-review-findings.md`)

- **CRIT-1** — the signed PDF artifact is still the DRAFT-watermarked preview; needs a final re-render with embedded signature images and a distinct `signed/` storage key.
- **CRIT-2** — the ceremony has no OTP / identity verification of the signer; the ceremony URL alone authenticates.
- Plus the HIGH / MEDIUM / LOW items from the consolidated review.

## [1.0.0-rc.3] — 2026-05-17 — Phase 1 (engagement: campaign builder + email tracking + outbound webhooks)

Phase 1 of ROADMAP_V2 closes 3 engagement features (drag-drop email campaign builder, email open/click tracking with HMAC-protected pixel + GDPR PII purge cron, outbound webhooks v2 with outbox pattern + envelope-encrypted secrets + DNS-rebinding defense). Plus Phase 1.1 patch sprint that closed 2 CRITICAL + 3 BLOCKER + 6 HIGH findings raised by `code-reviewer` and `security-red-team`. Final review verdicts: `code-reviewer` PASS_WITH_NITS, `security-red-team` GO (1 MED + 2 LOW, all deferred to Phase 1.1.1). Test count: **1665/1665 unit tests passing** (+173 since Phase 0 close at 1492).

### Deferred to Phase 1.1.1 (tracked in follow-up tickets)
- **CRIT-1 full** — `TenantSendingDomain` model + DKIM verify + `fromAddress` whitelist (partial fix shipped: send-test recipient must be active+verified User of tenant)
- **HIGH-4** — Per-event Zod payload schemas for webhook events (1-day refactor)
- **T-MAIL-T-03** — HTML body sanitizer (cheerio/DOMPurify) for `injectTracking`
- **T-MAIL-D-01** — `@Throttle` decorator on `/e/t/*` tracking endpoints
- **MED-4 + MEDIUM-1** — Outbox retention cron + suspended-tenant outbox cleanup
- **I-2** — Wire `CampaignRecipientsService.recordEvent` from `EmailTrackingService.recordOpen/Click` (counter increment path)
- **I-3** — `EmailService.sendTransactional` should call `injectTracking` (engagement reporting for workflow-driven emails)

### Added — Phase 1 (campaign builder + email tracking + outbound webhooks)

- **Email campaign builder backend (F2)** — extended `Campaign` model with envelope columns (`subject`, `fromName`, `fromAddress`, `replyTo`, `previewText`, `templateJson`, `scheduledAt`, `recipientFilter`) + per-campaign engagement counters (`recipientCount`, `sentSuccessCount`, `sentFailureCount`, `openCount`, `uniqueOpenCount`, `clickCount`, `uniqueClickCount`, `bounceCount`, `unsubscribeCount`, `spamReportCount`). New `CampaignRecipient` model with per-recipient HMAC tracking token, status lifecycle (PENDING → QUEUED → SENT → DELIVERED → BOUNCED/FAILED/SKIPPED). REST endpoints: `POST /campaigns/:id/send-test`, `POST /campaigns/:id/schedule`, `POST /campaigns/:id/cancel`, `POST /campaigns/:id/pause`, `POST /campaigns/:id/resume`, `GET /campaigns/:id/stats`. Send-test rate-limited 5/h/(campaign,user).
- **Email open / click / unsubscribe / bounce tracking (F1)** — HMAC-signed open pixel + click redirect (T-MAIL-S-01 engagement spoofing defense). New `EmailSuppression` model with hashed-email storage (GDPR data-minimization). Public `/e/u/:token` one-click unsubscribe endpoint (HMAC-protected, bilingual RO/EN response). Daily PII purge cron nullifies `ip_address` + `user_agent` on rows older than 90 days. Bounce handler API (`recordBounce`) auto-adds hard bounces to suppression.
- **Outbound webhooks v2 (F3)** — outbox pattern: business writes + `OutboxEvent` row commit in same Prisma transaction (T-WH-T-05 guaranteed delivery). New `OutboxPoller` (every 5s) drains PENDING rows + enqueues per-(endpoint, event) `webhook-delivery` jobs. `WebhookDeliveryProcessor` consumes with: HMAC-SHA256 signing (active + previous secret during 24h rotation grace per T-WH-T-03), DNS-pinned IP requests (DNS-rebinding defense, T-WH-S-02), SSRF allowlist via `UrlValidatorService` (Azure IMDS + platform apex + cluster.local blocked), auto-disable on 410 Gone or 20 consecutive failures, dead-letter on URL validation failure. New `WEBHOOK_SECRET_KEK` + `WEBHOOK_SECRET_KEK_KID` envelope-encryption of webhook signing secrets at rest.
- **Phase 1 migrations (11 total)** — `20260518100000_phase1_campaign_builder_enums`, `20260518100100_phase1_campaign_builder_columns`, `20260518110000_phase1_campaign_recipients`, `20260518120000_phase1_email_tracks_enums`, `20260518120100_phase1_email_tracks_columns`, `20260518130000_phase1_email_suppressions`, `20260518140000_phase1_webhooks_enums`, `20260518140100_phase1_webhooks_columns`, `20260518150000_phase1_tenant_email_tracking_enabled`, `20260518150500_phase1_outbox_events`, `20260518150600_phase1_webhook_rotation_grace`. All include GRANT to `app_user` and `ENABLE/FORCE ROW LEVEL SECURITY` for tenant-scoped tables.

### Fixed — Phase 1.1 patch sprint (post-review remediation, 2026-05-17)

- **CRIT-2 cross-tenant stats leak** — `EmailTrackingService.statsForMessage` now derives `tenantId` from the AUTHED caller's context first and scopes the message lookup with explicit `where: { id, tenantId: ctx.tenantId }` filter. Pre-fix, Tenant A could query the messageId of Tenant B and the service would silently `runWithTenant(message.tenantId, ...)` returning Tenant B's stats. Now 404 `EMAIL_NOT_FOUND` for cross-tenant lookups. CLAUDE.md rule #3 — defense in depth aligned on caller ctx.
- **CRIT-1 (partial) send-test phishing pipe** — `CampaignsService.sendTest` now rejects recipients that are not verified active `User` rows of the calling tenant (`SEND_TEST_RECIPIENT_NOT_USER`). Adds a GLOBAL 10/h/user budget across ALL campaigns (defeats per-campaign bypass via throwaway campaigns). Rate-limit responses now correctly use HTTP 429 instead of 400. **Deferred to Phase 1.1.1**: `TenantSendingDomain` model + DKIM verify + `fromAddress` whitelist (larger refactor, separate sprint).
- **BLOCKER-1 suppression bypass on multi-recipient sends** — `EmailService.send` now persists the FILTERED recipient buckets in the `EmailMessage` row, not the raw DTO arrays. Audit emits `email.suppression.skip_send` on ANY partial drop (not only `allSuppressed`). Pre-fix the suppression check was theatre — Nodemailer would still send to suppressed addresses.
- **BLOCKER-2 schema drift `CampaignRecipient.messageId` FK** — SQL migration `20260518110000` already created the FK, but the Prisma model lacked the matching `@relation`. Added `message EmailMessage? @relation(... onDelete: SetNull)` + back-relation `campaignRecipients CampaignRecipient[]` on `EmailMessage`. Additive Prisma-only change; no new migration generated.
- **BLOCKER-3 F1↔F3 loop wiring** — `EmailTrackingService` (recordOpen/Click/Unsubscribe/Bounce) and `CampaignsService` (launch/schedule) now publish to the outbox **in the same transaction** as the business write. 6 new `WebhookEvent` values now actually flow to subscribers: `EMAIL_OPENED`, `EMAIL_CLICKED`, `EMAIL_BOUNCED`, `EMAIL_UNSUBSCRIBED`, `EMAIL_SPAM_REPORTED`, `CAMPAIGN_SENT`. (`CAMPAIGN_COMPLETED` deferred until the dispatcher processor lands.)
- **HIGH-1 open-pixel HMAC replay dedup (T-MAIL-S-02)** — new migration `20260518160000_phase1_1_email_track_dedup` adds a partial unique index on `(message_id, kind, ip_address, date_trunc('hour', created_at))` filtered to `kind IN ('OPEN','CLICK') AND ip_address IS NOT NULL`. `recordOpen` + `recordClick` swallow `P2002` so Outlook prefetch / Gmail proxy multi-hits within the same hour collapse to one tracked event (counters were inflating 2–5×).
- **HIGH-2 webhook CRUD audit** — `WebhooksService.create/update/delete/rotateSecret` and `WebhookDeliveryProcessor.disableEndpoint` now emit `webhook.endpoint.created/updated/deleted/secret_rotated/auto_disabled` audit rows. Secret plaintext NEVER written to audit metadata (only KEK kids).
- **HIGH-3 webhook deliveries continue post tenant deactivation** — `OutboxPoller` now filters events whose tenant has `isActive=false` or `suspendedAt != null` (events held back, not dropped — so reversed suspensions can still ship). `WebhookDeliveryProcessor.process` re-checks tenant status at delivery time (race between poll and delivery) and writes a `webhook.delivery.skipped_tenant_inactive` audit row.
- **HIGH-5 / HIGH-6 role tightening** — `VIEWER` removed from `/email/:id/tracking` stats (T-MAIL-I-03, PII-adjacent engagement data); `MANAGER` removed from `/webhooks/:id/deliveries` (T-WH-I-03 — delivery payloads contain business PII like deal amounts, invoice totals).
- **I-4 HTTP 429 on rate limit** — send-test rate-limit responses now use `HttpException(..., HttpStatus.TOO_MANY_REQUESTS)` instead of `BadRequestException` so clients can implement `Retry-After` correctly.
- **I-5 env documentation** — `.env.example` now documents `CAMPAIGN_HMAC_KEY`, `EMAIL_TRACKING_REQUIRE_SIG`, `EMAIL_CAMPAIGN_RATE_PER_SEC`, `EMAIL_CAMPAIGN_BURST`, `WEBHOOK_SECRET_KEK`, `WEBHOOK_SECRET_KEK_KID` with generators and production requirements.

## [1.0.0-rc.2] — 2026-05-17 — Phase 0 (i18n + multi-currency + saved-views)

Phase 0 of ROADMAP_V2 closes 3 foundation features (saved views CRUD, multi-currency with daily ECB rates, EN UI preview behind feature flag) plus a security hardening pass (FX sanity reject, scoped SavedView writes, bidi block, audit event naming canonical). Reviewed by `code-reviewer` (PASS_WITH_NITS), `security-red-team` (HIGH — no CRITICAL), `accessibility-auditor` (PASS_WITH_FIXES — all fixed). Test count: 1492/1492 unit tests passing.

### Added (2026-05-17 — Phase 0 Sprint 2: i18n + multi-currency + saved-views hardening)

- **Multi-currency for Deals** (`feat(fx-rates)` [e06dae8](../../commit/e06dae8)): deals can now be created in EUR, USD, GBP, CHF, PLN (in addition to RON). A daily cron at 06:00 Europe/Bucharest fetches official ECB reference rates; every deal stores `amountBase` (Decimal) + `fxRateAt` (Date) snapshots in the tenant base currency so dashboards and forecasts roll up correctly across currencies. New public endpoint `GET /api/v1/exchange-rates?from=&to=&date=` (JWT-guarded, throttled 100/min/tenant) returns the most recent rate ≤ date (defaults to today) with a `stale` flag when ECB had a > 24h gap (weekend/outage). FX math is end-to-end `Prisma.Decimal`; 15 % day-over-day sanity bound emits a Prometheus counter when violated.
- **English UI (preview)** (`feat(i18n)` [9b3dcc6](../../commit/9b3dcc6)): `react-i18next` wired with RO eager + EN lazy chunk (~30 KB). New `LanguageSwitcher` component on `/app/settings/appearance` with optimistic UI + rollback on API failure. Hidden behind `VITE_FEATURE_I18N_EN` env flag until the EN catalog is fully translated. CI now runs an RO ↔ EN key-parity script before `pnpm build`. Bundle impact: main +22 KB gzip eager (RO catalog + i18next core); EN split into 52 lazy chunks loaded only when the user switches.
- **Per-user + per-tenant locale endpoints** (`feat(i18n)` [9b3dcc6](../../commit/9b3dcc6)): `PATCH /api/v1/users/me/locale` (any authenticated role) sets the caller's preferred UI language; `GET /api/v1/tenant/locale` reads tenant defaults; `PATCH /api/v1/tenant/locale` (OWNER/ADMIN only) updates `defaultLocale` + `enabledLocales` atomically with cross-field constraint (`defaultLocale ∈ enabledLocales`). Cascade resolution `user → tenant → 'ro'` shared between BE and FE via `@amass/shared/locale`.
- **Saved views — system defaults + hardening** (`feat(saved-views)` [eeb9b10](../../commit/eeb9b10)): new `GET /api/v1/saved-views/system-defaults?resource=deals` returns 3 hardcoded starter views (mine / won this month / lost last 30 days) using i18n keys + `system:` id prefix. New `GET /api/v1/saved-views/:id` (owner-scoped 404, no cross-tenant existence leak). Every mutation now emits `saved_view.{create,update,delete}` audit rows. Per-route 16 KB payload cap on `POST` + `PATCH` (413 PAYLOAD_TOO_LARGE) — the global 2 MB JSON limit stays for file/import endpoints.
- **Phase 0 schema foundation** (`feat(schema)` [ddb3b2e](../../commit/ddb3b2e)): migration `20260517082112_phase_0_locale_currency_views` adds `Tenant.baseCurrency` (default `'RON'`), `Tenant.defaultLocale` (default `'ro'`), `Tenant.enabledLocales` (default `['ro','en']`), `User.preferredLocale` (default `'ro'`), `Deal.amountBase` (Decimal(14,2)?), `Deal.fxRateAt` (Date?), and a NEW global `ExchangeRate` table (REVOKE-protected at DB layer, deliberately NOT tenant-scoped). Backfill: `amount_base = value` for existing RON deals.

### Changed (2026-05-17)

- `Deal` model: `UpdateDealSchema.strict()` now rejects `amountBase` / `fxRateAt` in PATCH bodies — both are server-computed only (T-FX-T-02).
- `DealsService.create/update`: when `value` or `currency` change, the service recomputes `(amountBase, fxRateAt)` via `FxRatesService.convert`. Historic snapshots are never recomputed (T-FX-T-03 immutability).
- `TENANT_SCOPED_MODELS` set gained 8 missing models (catch-all regression test introspects the Prisma DMMF) ([84bde4d](../../commit/84bde4d)).

### Security (2026-05-17)

- **Saved views — XSS / prototype pollution / DoS hardening** (T-SV-I-03, T-SV-T-02, T-SV-D-01): server-side regex rejects ASCII control chars + literal `<script>`/`<iframe>`/`javascript:`/`on*=` patterns in view `name`; Zod `superRefine` blocks `__proto__` / `prototype` / `constructor` keys at any nesting depth in `filters`; recursion depth capped at 8 levels; per-route payload cap at 16 KB.
- **FX rates — supply chain + DoS hardening** (T-FX-S-02, T-FX-D-01..D-03, T-FX-E-01): ECB client is HTTPS-only with hostname pinning, strict-regex XML parse (no full XML parser), 10 s `AbortSignal` timeout. Redis cache (TTL 1h) absorbs read bursts. Supported-currency enum is a closed whitelist (RON, EUR, USD, GBP, CHF, PLN). 15 % day-over-day sanity bound trips a Prometheus counter on violation.
- **i18n — bidi / RTL / repudiation hardening** (T-I18N-S-02, T-I18N-T-02, T-I18N-R-01, T-I18N-D-01): `LocaleSchema` whitelist rejects Unicode bidi-control codepoints; i18next configured with `escapeValue: false` only where React already escapes; every locale change writes an audit row; `Accept-Language` parsing caps at the first 10 entries to defuse 1000+ q-value CPU exhaustion.

### Added (2026-05-14 — script-compliance MVP + lead-scoring cron + imports history UI)

- **Script-compliance AI (MVP)** (`feat(ai-worker, call-scripts)`): new per-tenant `Tenant.defaultCallScript` JSON column (migration `20260514220000_tenant_default_call_script`) holds an ordered list of points the agent should hit on a call. New `CallScripts` API module exposes `GET/PUT /api/v1/call-scripts/default` (OWNER/ADMIN write, all roles read). On every recording webhook, `CallsService.handleRecordingWebhook` now passes the points to the AI worker via the BullMQ payload (`scriptPoints` field on `AiCallJobPayload`). New `apps/ai-worker/app/script_compliance.py` uses Claude (model `claude-sonnet-4-6`) to produce `{score 0-100, missed: string[]}` with strict JSON-output prompting; falls back to NULL when `ANTHROPIC_API_KEY` is unset (UI hides the widget) or when transcript is too short. New web route `/app/settings/call-script` (lazy-split page) — full editor for the script with add/remove/reorder, 5 suggested Romanian templates, 50-point hard cap matching backend validation. Sidebar entry under Administrare.
- **Lead-scoring cron** (`feat(lead-scoring)`): new `LeadScoringScheduler` fires daily at 04:00 UTC, enumerates active tenants, enqueues one `recompute-tenant` BullMQ job per tenant on the `lead-scoring` queue. Idempotent via per-day `jobId`. Closes the gap where leads list always showed score=0 because the recompute was never triggered.
- **Imports history UI** (`feat(web)`): new `/app/imports` route with table view of `import_jobs` rows — file name, type label (Companii/Contacte/Clienți/…), status badge with progress %, total/OK/skipped/failed counts, created-at timestamp. Auto-polls every 3 s while a job is `PENDING`/`PROCESSING`, every 30 s otherwise. Sidebar entry under Operațional.

### Added (2026-05-14 — call AI pipeline end-to-end + Twilio real + Whisper RO + control-doc sync)

- **Twilio real credentials wired** (`feat(calls)`): replaced mock SID/token with real Trial account (`AC17ff…`), purchased US Twilio number `+19786277500` with voice webhook → `{tunnel}/api/v1/calls/webhook/voice`, verified outgoing caller ID `+40754070368` (RO). Live call test: 13s call to RO mobile, $0.028, `Status: completed`, full webhook lifecycle observed (QUEUED → IN_PROGRESS → COMPLETED → recording).
- **Whisper RO transcription activated** (`feat(ai-worker)`): uncommented `openai-whisper` in `requirements.txt`, rewrote `transcription.py` to use the real path with module-level import-guarded fallback. Started at `WHISPER_MODEL=base`, upgraded to `medium` (~95% accuracy on 60s RO TTS sample), then to `large-v3` per user request (96-98% accuracy on technical Romanian; ~0.7× real-time on CPU). Language auto-detected as `ro`.
- **Recording → MinIO upload + Attachment auto-creation** (`feat(ai-worker, calls)`): new `apps/ai-worker/app/storage.py` uploads downloaded recording to MinIO under `tenants/{tenantId}/calls/{callId}/{recordingSid}.mp3`; `AiCallResultSchema` (shared) now carries `recordingStorageKey`/`recordingMimeType`/`recordingSizeBytes`; `CallsService.saveAiResult` persists the key on the Call row AND creates an `Attachment` row tied to the call's subject (Contact/Client/Company) — the recording shows up in the client's "Fișiere" tab automatically with name `Înregistrare apel YYYY-MM-DD HH:MM <number>.mp3`. Verified end-to-end live on call `cmp5gzwi0…`.
- **Daily agent calls report** (`feat(reports)`): new `GET /api/v1/reports/agent-calls?date=YYYY-MM-DD&userId=…` returns per-agent list of calls for the day with `MM:SS` duration, contact name + phone (subjectType lookup across contacts/clients/companies), direction, status. New "Desfășurător apeluri zi" tab on `/app/reports` with table grouped per agent.
- **Pipeline AI activity logging** (`feat(activities)`): `ActivityEntry` now accepts explicit `tenantId` + `actorId` for callers running outside JWT/ALS context (Twilio webhooks). `CallsService.handleStatusWebhook` passes them on `call.completed` — previously dropped silently with "Activity dropped — no tenant context".

### Fixed (2026-05-14)

- **`POST /custom-fields/defs` 400** (`fix(web)`): FE form was sending `{ entityType, name, fieldType, isRequired }` but the BE Zod schema requires `label` (human-readable) plus `name` matching `^[a-z][a-z0-9_]*$`. Added `label` input to `SettingsCustomFieldsPage`; `name` is now an optional tech-key (auto-derived from label via diacritic-strip + snake_case if blank); client-side validation against the same regex with a friendly error message.
- **`POST /webhooks/endpoints` 400 on "all events"** (`fix(api)`): BE schema required `events: z.array().min(1)`, but FE UX shows "Evenimente: toate" when `length === 0` (semantically "subscribe to all"). Relaxed BE to `z.array()` with no min so the documented FE intent works for both create and update.
- **Company detail page had no Delete button** (`fix(web)`): added `<Button>Șterge</Button>` (Trash2 icon) in `DetailLayout.actions` slot on `CompanyDetailPage` with `confirm()` + `companiesApi.remove(id)` mutation, toast on success, navigate back to `/app/companies`.
- **Forecasting page 400** (`fix(web)`): FE sent `periodType: 'MONTH'|'QUARTER'|'YEAR'`, BE Zod enum accepts only `MONTHLY|QUARTERLY`. Aligned FE type to `'MONTHLY' | 'QUARTERLY'`, replaced both call-sites in `forecasting.page.tsx`.
- **Custom Fields list 404** (`fix(web)`): FE called `/custom-fields?entityType=COMPANY`, BE mounts the resource under `/custom-fields/defs` (`/defs` vs `/values/:id` sub-paths inside one controller). Updated `customFieldsApi.{list,create,toggle}` to hit `/defs`.
- **Cockpit page "Not Found"** (`fix(infra)`): API container was running a 10-day-old `dist/main.js` that pre-dated `CockpitModule` registration. Webhook URLs in old `.env` still pointed at mock Twilio. Recreated `amass-api` after rebuild so all module changes from the past 10 days (`2346629`, `181c838`, `f6361f6`, `7fd93f6` cockpit commits + the security-spec sweep) are live. `/api/v1/cockpit/feed` and `/cockpit/layout` now return 200 with real deal data for the Dana tenant.
- **GestCom adapter never invoked on real PDFs** (`fix(importer)`): `ImportProcessor.process` was calling `Papa.parse` directly on every uploaded file, generating 6376 zero-name rows on a 149-page PDF. Three sub-issues stacked: (1) `pickAdapter` was never called from the processor; (2) `GestComAdapter.canHandle` required `gestcom|lucrari|amass` in the filename, which rules out the WhatsApp-renamed `unnamed document.pdf`; (3) Nume/Prenume/Oras regex assumed one field per line, but `pdf-parse` sometimes collapses an entire record onto one line. Fixed by introducing adapter-first routing (`pickAdapter({fileName, magicBytes})` + new `StorageService.getObjectAsBuffer`), adding `gestcom.ro/` content-sniff to `canHandle`, and rewriting the field-extract regex with look-aheads to the next known label. Verified live: 96/96 records extracted from Radu's real GestCom export (`POST /imports?type=CLIENTS` → status `COMPLETED`, `succeeded=94 + skipped=2 + failed=0`).
- **`speaker: null` in AI worker payload broke `/ai-result` (400)** (`fix(ai-worker)`): Zod's `.optional()` rejects `null` (only `undefined`/missing passes). Stub-mode segments included `speaker: None` which JSON-serialised as `null`. Now `pipeline.py` strips `None` keys per-segment before POSTing, matching the top-level cleanup that already existed.
- **Docker `amass-ai-worker` image bloat (9.02 GB → 1.96 GB, −78%)** (`fix(deploy)`): default `pip install torch` pulls `nvidia-cublas`, `cudnn`, `cusparselt`, `nccl`, `triton` etc. for aarch64 — useless on CPU-only deploys, ~8 GB of dead layers. Pinned `torch==2.4.1` with `--index-url https://download.pytorch.org/whl/cpu` before installing the rest of `requirements.txt`. Identical Whisper behaviour on CPU; Railway/Hetzner layer storage now sane.

### Documentation hygiene (2026-05-14)

- **AGENTS.md startup-checklist gap**: the required reads of AGENTS / CLAUDE / CHANGELOG / LESSONS / SECURITY_FINDINGS / RELEASE_CHECKLIST were skipped for ~5 hours of code changes in this session. All session work was back-filled into the control docs in one batch at the end.

### Added (2026-05-10 / 2026-05-11 — D-task sweep)

- **Entity 360 relationship health** (`feat(entity360)` `13faa8c`): new `/entity-health/:type/:id` endpoint returning a 0–100 score, per-signal breakdown, and a Romanian one-sentence summary. New `RelationshipHealthCard` (SVG dial + 4 signal tiles) mounted on company/contact/client detail pages. No LLM calls on the hot path.
- **Command Palette quick actions** (`feat(cmdk)` `83b3a8a`): three new "Acțiuni rapide" — Adaugă task / Înregistrează apel / Trimite email — open inline confirmation forms inside the Cmd-K modal; audit log entries are created automatically by the underlying controllers.
- **GestCom PDF importer** (`feat(importer)` `38b265f`): adapter for `gestcom.ro/<tenant>/lucrari` PDF exports. Splits the table-row anchor, extracts contact identity (Nume/Prenume/Email/Telefon/Oras/Suprafata) plus GestCom-specific metadata (situatie, judet, stadiu, data_decizie, observatii). Activates only when filename contains `gestcom|lucrari|amass-export`. Also fixes a hidden `pdf-parse` v2 API breaking change in the generic `PdfAdapter`.
- **Illustrated EmptyState** (`feat(ui)` `cb427c4`): 3 inline-SVG variants (`empty-list` / `no-results` / `error`) replace the icon badge on companies, contacts, clients list pages.
- **Bundle analyzer** (`chore(web)` `bf7dab2`): `pnpm build:analyze` (or `ANALYZE=1 vite build`) produces `dist/stats.html` via rollup-plugin-visualizer.
- **PWA browser smoke** (`test(web)` `a036948`): `pwa-smoke.e2e.ts` verifies manifest + icons + sw.js + robots.txt + meta tags on any deployed URL. `pnpm e2e:smoke` runs only the smoke files. Docs in `apps/web/e2e/README.md`.
- **Service worker unit test** (`test(web)` `3f81d96`): runs `public/sw.js` in a vm sandbox with mocked Cache API to verify the 4 routing rules (cache-first assets, network-first HTML, network-only `/api/*`, CLEAR_CACHES logout flow).
- **+20 unit specs** (`test(api)` `12055bf`): `OutlookEmailService` (OAuth CSRF/replay defenses), `ai/SearchService`, `JwtAuthGuard` (NO_TOKEN / INVALID_TOKEN / TOKEN_REVOKED / TENANT_SUSPENDED paths). Suite total now **1087** API tests across 108 files.

### Changed (2026-05-10 / 2026-05-11)

- **Onboarding wizard copy** (`feat(ui)` `5c2f453`): replaced dev jargon (RLS / Cedar / Whisper / Presidio / UBL) with plain-Romanian user benefits across all 4 wizard steps.
- **Cockpit drag-drop polish** (`feat(ui)` `0bc0d73`): scale + shadow + cyan glow on drag and drop targets; grip handle highlights when grabbed.
- **A11y** (`feat(a11y)` `a587b30`): skip-to-content link, `<main id="main-content">`, `aria-label` on sidebar, `role="menu"` on UserMenu dropdown.
- **Favicon + SEO** (`feat(web)` `f93d16f`): voice-wave accent on the `A` mark, OpenGraph + Twitter meta tags, `lang="ro"`, `robots.txt`.
- **Docs hygiene** (2026-05-11): removed point-in-time snapshot files (`STATUS.md`, `TEST_REPORT.md`, `UNFINISHED.md`, `docs/UNFINISHED.md`, `docs/SESSION_REPORT_2026-04-28.md`, `docs/VERIFICATION_REPORT_2026-04-28.md`, `LAUNCH_CHECKLIST.md`). `CHANGELOG.md` + `git log` are the cross-session history; `RELEASE_CHECKLIST.md` is the live launch gate. Agent prompts (`AGENTS.md`, `agents/*.md`) updated to match.

### Security

- SEC-004: RLS deny-by-default when tenant context is missing — migration `20260504065000_rls_deny_missing_tenant` (`4415c21`)
- SEC-005: Notifications Socket.IO gateway uses `CORS_ALLOWED_ORIGINS` and reads `payload.tid` (was `payload.tenantId`) (`2c2a68a`)
- SEC-006 (auth gate): AI worker `/process/call` now requires `Authorization: Bearer ${AI_WORKER_SECRET}` (`25f096b`)
- SEC-006 (residual): `_is_recording_url_safe()` enforces HTTPS, host allow-list, public-IP-only resolution (`a6bcc5a`)
- SEC-007: `WEBHOOK_TRUSTED_HOSTS` rejected in production via `prodOnlyChecks` (`6a6fc4c`)
- SEC-008: Webhook secret rotation endpoint `POST /webhooks/endpoints/:id/rotate-secret` with one-time-display policy (`a9fca1a`)
- Webhooks: DNS-rebinding protection via IP pinning at delivery time (`25f096b`)
- Dependencies: axios pinned to ≥1.15.2 to close 4 HIGH CVEs reachable via `twilio` (`63628e9`)
- CI: gitleaks secret-scan workflow on every push, PR, and weekly schedule (`855f241`)

### Added

- Microsoft Graph email integration (Outlook OAuth)
- Polymorphic tag system across companies/contacts/clients/deals/leads
- Cloudflare quick tunnel for live demo
- Critical CRM browser smoke (Playwright) covering company create, attachment upload + presigned download with byte comparison, task complete, reminder dismiss

### Changed

- LAUNCH_CHECKLIST.md marked DEPRECATED; RELEASE_CHECKLIST.md is now the single authoritative launch gate
- Standalone tasks (no deal, no subject) are now allowed (created from `/tasks` page)
- All unsafe `Zod.parse()` calls replaced with `safeParse()` + `BadRequestException`
- MinIO presigned URLs now use a separate `presignClient` so URLs reach the browser through Caddy's `/amass-files/*` proxy

### Fixed

- Tasks: `assertExactlyOneLink` no longer rejects standalone tasks
- MinIO: presigned URLs no longer contain Docker-internal hostname

## Earlier history

The project shipped in sprints S0–S55 between September 2025 and April 2026. Notable milestones:

- **S0–S2**: NestJS + Prisma skeleton, multi-tenant auth, RLS, audit log
- **S3–S6**: Companies, Contacts, Clients (B2B/B2C), Notes timeline, Attachments via MinIO
- **S7–S10**: Reminders + BullMQ, frontend skeleton + detail pages, Pipelines/Deals/Tasks
- **S11–S14**: Email + tracking, Calls (Twilio), AI worker (Whisper + Presidio + Claude pipeline)
- **S15–S20**: Workflows + sequences, Reports, GDPR, observability, Railway deploy, polish
- **S30–S35**: Quotes, email sequences, contact segments, deal forecast, Swagger/OpenAPI
- **S36–S40**: Custom fields, approvals, duplicates dedup, products, SSO/SAML
- **S41–S46**: WhatsApp, ANAF e-Factura, Calendar, Report Builder, Lead Scoring, Client Portal
- **S47–S52**: Notifications, Export, SMS, Webhooks, Billing (Stripe), AI Enrichment
- **S53–S55**: Leads, Contracts, Forecasting

Detailed sprint notes and security findings: [`docs/`](./docs/) and [`SECURITY_FINDINGS.md`](./SECURITY_FINDINGS.md).
