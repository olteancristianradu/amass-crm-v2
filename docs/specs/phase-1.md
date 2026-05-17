# Phase 1 — Engagement: Acceptance Criteria (Gherkin)

> **Status:** DRAFT · **Owner:** `product-manager` sub-agent · **Date:** 2026-05-17
> **For:** `backend-engineer` + `frontend-engineer` + `qa-automation` + `code-reviewer` + `security-red-team`
> **Source plan:** [`docs/ROADMAP_V2.md`](../ROADMAP_V2.md) §2 Phase 1 (Engagement, 4 weeks)
> **Rule reference:** [`CLAUDE.md`](../../CLAUDE.md) #2 (proof of done), #3 (tenant isolation), #6 (no scope creep), #8 (coverage), #11 (lint+test)

Markeri inline:
- `[verificat]` — citit din cod/schema azi (2026-05-17)
- `[propus]` — nu există încă în repo, trebuie creat / migrat
- `[presupun]` — inferență; flagged for sign-off
- `[depășește contextul]` — nu am acces (ex: SMTP-provider contracts)

## Reality check — 2026-05-17, executat live

**Module deja schelet-uite (NU pornim de la zero):**
- `apps/api/src/modules/campaigns/` — `campaigns.service.ts`, controller, spec exist `[verificat]`. Cedar-guarded, RBAC enforced, cursor-paginated CRUD pe `Campaign` model.
- `apps/api/src/modules/email-tracking/` — pixel + click endpoints LIVE `[verificat:email-tracking.controller.ts]`: `GET /e/t/:id/open.gif`, `GET /e/t/:id/click?u=&s=`. HMAC sig peste `(messageId, url)` cu `JWT_SECRET`, 16-hex truncated, `timingSafeEqual`. Public, IP+UA capture, RLS-scoped writes via `runWithTenant(message.tenantId)`. `EMAIL_TRACKING_REQUIRE_SIG` env default `'true'` `[verificat:config/env.ts:105]`.
- `apps/api/src/modules/webhooks/` — full SSRF-defended dispatcher `[verificat:webhooks.service.ts]`: `validateUrl()` blocks 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped re-check. **DNS rebinding defense** = re-validate la delivery + pin IP. HTTPS only in prod, no userinfo. HMAC `sha256=...` signature. `webhook-deliveries` table cu `tenantId` (RLS scoped per P0-3 audit). 10s timeout, 2 KiB response body cap, redirect blocked. Secret rotation endpoint exists.
- `apps/api/src/modules/email/email.service.ts` — `sendTransactional()` already exists pentru system sends. `injectTracking()` rewrites HTML cu pixel + signed click-through la send time.

**Schema deja prezent:**
- `EmailMessage` la `schema.prisma:773` `[verificat]` cu `bodyHtml @db.VarChar(1048576)` (1 MiB cap), `status EmailStatus`, `messageId` (SMTP), indexes pe `(tenantId, status)`.
- `EmailTrack` la `schema.prisma:815` `[verificat]` cu `kind EmailTrackKind {OPEN, CLICK}`, `ipAddress`, `userAgent`, `url`, indexes `(tenantId, messageId, createdAt)` + `(tenantId, kind, createdAt)`.
- `Campaign` la `schema.prisma:2273` `[verificat]` cu `name`, `status CampaignStatus {DRAFT, ACTIVE, PAUSED, COMPLETED}`, `channel CampaignChannel {EMAIL, SMS, WHATSAPP, MIXED}`, `segmentId`, `budget`, `targetCount`, `sentCount`, `conversions`, `revenue`. **NU are** `templateJson`, `templateHtml`, `subjectLine`, `fromEmail`, `scheduledAt`, `senderAccountId` — toate trebuie adăugate `[propus]`.
- `WebhookEndpoint` la `schema.prisma:1944` + `WebhookDelivery` la `:1960` `[verificat]`. Enum `WebhookEvent` la `:1932` are 9 valori: `COMPANY_CREATED`, `COMPANY_UPDATED`, `CONTACT_CREATED`, `DEAL_CREATED`, `DEAL_STATUS_CHANGED`, `INVOICE_ISSUED`, `QUOTE_ACCEPTED`, `CALL_COMPLETED`, `APPROVAL_DECIDED`. **Lipsesc** `EMAIL_OPENED`, `EMAIL_CLICKED`, `CAMPAIGN_SENT`, `CAMPAIGN_COMPLETED` — toate adăugate `[propus]` în Phase 1 ca să închidă bucla cu F1.
- `ContactSegment` la `:1357` `[verificat]` cu `filterJson Json`. Folosit ca audience source pentru campaign send.
- `ConsentRecord` la `:2605` `[verificat]` cu `purpose ConsentPurpose`, `status ConsentStatus`, `lawfulBasis LawfulBasis`. **Trebuie** purpose nou `EMAIL_TRACKING` `[propus]` ca să facem opt-out per contact (granular > tenant-level).

**Send infrastructure:**
- Provider: **Nodemailer over SMTP per-account** `[verificat:email.processor.ts:74]`. Each tenant configurează `EmailAccount` cu `smtpHost`, `smtpPort`, `smtpUser`, `smtpPassEnc` (AES-encrypted). NO Mailgun/SES/SendGrid in repo. Sender accountability is delegated to the SMTP server the tenant chose (Gmail App Password, Microsoft 365, AWS SES via SMTP, etc).
- **Implication pentru F2:** "From-address verification (DKIM)" e responsabilitatea SMTP provider-ului, nu a CRM-ului. Decizia de a forța DKIM check intra-CRM = scope creep — nu o luăm acum.
- BullMQ queue `email` `[verificat:queue.constants.ts]` cu `lockDuration: 60_000`. Jobs idempotent prin `jobId = message.id`.

**Decizii pre-baked (NU mai întreabă user-ul):**
- **Send infra:** SMTP per-tenant existent. NO new provider. `[verificat]`
- **Webhook DLQ visibility:** `WebhookDelivery` rows deja persistă `success`, `statusCode`, `responseBody` — UI panel = afișare top 100 deja exists endpoint `GET /webhooks/endpoints/:id/deliveries`. **Default = DA, panel exists schelet, UI build = Phase 1 scope.**
- **From-address verification:** DELEGATED to SMTP provider. **OUT OF SCOPE** for Phase 1.

---

## Feature F1 — Email open/click tracking

**Effort:** 7 zile (roadmap §2 P1). **Realitate adjusted:** 3-4 zile pentru că pixel + click + sig deja exist `[verificat]`. Restul: **opt-out per-contact**, **unsubscribe footer**, **aggregation API pe Campaign**, **IP/UA retention policy**, **rate limit**.

### Story F1.1 — Sales rep vede statusul "Deschis" pe un email trimis

**As a** sales rep `radu@acme.ro`
**I want** să văd când un prospect a deschis email-ul meu și de câte ori
**So that** știu cine e cald și pe cine să sun azi vs săptămâna viitoare

#### Scenario: Open event înregistrat la prima vizualizare
```gherkin
Given user radu@acme.ro sent email msg_abc123 to john@globex.com via POST /api/v1/email/send
  And the rendered HTML body contains pixel <img src="https://api.amasscrm.ro/api/v1/e/t/msg_abc123/open.gif" />
When john@globex.com opens the email in Gmail (which auto-loads images)
  And Gmail's image proxy fetches GET /api/v1/e/t/msg_abc123/open.gif with User-Agent "GoogleImageProxy"
Then the response is 200 with Content-Type "image/gif", Cache-Control "no-store, max-age=0", body = 43-byte transparent GIF
  And one EmailTrack row is inserted: { messageId: 'msg_abc123', kind: 'OPEN', ipAddress: '<Google IP>', userAgent: 'GoogleImageProxy', createdAt: <now> }
  And the row has tenantId = 'acme-ro' (looked up from EmailMessage.tenantId, not from request — request is unauthed)
  And the write goes through runWithTenant('acme-ro', ...) so RLS policies apply
```

#### Scenario: Multi-open count (same recipient opens twice)
```gherkin
Given john@globex.com already opened msg_abc123 at 10:00 UTC
When john@globex.com re-opens the email at 14:00 UTC (e.g. archived then re-read)
Then a SECOND EmailTrack row is inserted with kind='OPEN', createdAt=14:00 UTC
  And GET /api/v1/email/msg_abc123/tracking returns { opens: 2, clicks: 0, lastOpenedAt: '2026-05-17T14:00:00Z' }
  And the UI on /email/msg_abc123 shows badge "Deschis 2×" (ro-RO) sau "Opened 2×" (en-US)
```

#### Scenario: Click event with HMAC validation
```gherkin
Given outbound HTML contained <a href="https://acme.ro/pricing">Vezi prețuri</a>
  And injectTracking rewrote it to https://api.amasscrm.ro/api/v1/e/t/msg_abc123/click?u=https%3A%2F%2Facme.ro%2Fpricing&s=<16-hex-sig>
  And the signature was computed: HMAC_SHA256(JWT_SECRET, 'email-track:msg_abc123|https://acme.ro/pricing').slice(0,16)
When john@globex.com clicks the link
  And the browser hits GET /api/v1/e/t/msg_abc123/click?u=https%3A%2F%2Facme.ro%2Fpricing&s=<sig>
Then the response is 302 Location: https://acme.ro/pricing
  And one EmailTrack row is inserted: { kind: 'CLICK', url: 'https://acme.ro/pricing', ipAddress: <john's IP>, userAgent: <john's browser UA> }
  And no <Set-Cookie> header is sent (privacy — we don't tag the user across visits)
```

#### Scenario: Open-redirect attack rejected (HMAC mismatch)
```gherkin
Given attacker knows msg_abc123 exists (leaked from forwarded email)
When attacker crafts GET /api/v1/e/t/msg_abc123/click?u=https%3A%2F%2Fphishing.evil.com&s=0000000000000000
Then the response is 404 { code: 'TRACKING_LINK_INVALID', message: 'Link not found' }
  And NO EmailTrack row is inserted
  And NO redirect occurs (defeats open-redirect via legitimate CRM domain) [verificat:email-tracking.service.ts:128]
  And a warn log is emitted: { msg: 'Click rejected: invalid signature for messageId=msg_abc123' }
```

#### Scenario: Non-http(s) target rejected (javascript: / data: defense)
```gherkin
When attacker crafts GET /api/v1/e/t/msg_abc123/click?u=javascript%3Aalert(1)&s=<valid-sig-somehow>
Then the response is 404 (isSafeHttpUrl returns false before HMAC check) [verificat:email-tracking.service.ts:124]
  And NO redirect, NO EmailTrack row
```

#### Scenario: Per-contact opt-out — pixel not embedded for unsubscribed recipient
```gherkin
Given contact john@globex.com has ConsentRecord { purpose: 'EMAIL_TRACKING', status: 'REVOKED' } [propus: new purpose enum value]
  And sales rep sends email to john via POST /api/v1/email/send { subjectType: 'CONTACT', subjectId: 'cnt_john', ... }
When EmailService.send runs injectTracking
Then injectTracking checks ConsentRecord for (tenant, CONTACT, cnt_john, EMAIL_TRACKING)
  And finds REVOKED status
  And SKIPS pixel injection
  And SKIPS click-rewrite (links remain raw <a href="https://acme.ro/pricing">)
  And the EmailMessage.bodyHtml stored in DB has NO tracking pixel
  And audit log records { action: 'email.tracking.skipped', subjectId: 'cnt_john', reason: 'CONSENT_REVOKED' }
```

#### Scenario: Tenant-wide tracking opt-out (admin disables for all)
```gherkin
Given tenant acme-ro admin sets TenantSetting { key: 'email.tracking.enabled', value: 'false' } [propus]
When ANY sales rep in acme-ro sends an email
Then injectTracking returns the HTML unchanged (NO pixel, NO click-rewrite)
  And no EmailTrack row is ever created for that tenant
  And GET /api/v1/campaigns/:id/stats returns { opens: 0, clicks: 0, openRate: null, clickRate: null, trackingDisabled: true }
```

#### Scenario: Unsubscribe footer link present in all marketing emails
```gherkin
Given user sends an email tied to a Campaign (campaign-driven send, not 1-on-1) via POST /api/v1/campaigns/:id/send
When EmailService.send runs
Then the bodyHtml ENDS with footer block:
  """
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="font-size:12px;color:#6b7280;text-align:center">
    Primești acest email pentru că ești în lista <strong>{{campaign.name}}</strong>.
    <a href="https://api.amasscrm.ro/api/v1/u/{{unsubscribeToken}}">Dezabonare</a>
  </p>
  """
  And unsubscribeToken = HMAC_SHA256(JWT_SECRET, 'unsub:' || contact.id).slice(0,32) [propus]
  And the footer is NOT added for 1-on-1 transactional emails (POST /api/v1/email/send without campaignId) — only legitimate marketing requires unsubscribe [presupun: based on GDPR Art. 6.1.f legitimate-interest interpretation]
```

#### Scenario: Unsubscribe link click → revokes consent + 200 confirmation
```gherkin
When john@globex.com clicks the unsubscribe link
  And the browser hits GET /api/v1/u/<token>
Then the system verifies HMAC over the token's contact id
  And on valid token: upsert ConsentRecord { contactId, purpose: 'EMAIL_MARKETING', status: 'REVOKED', revokedAt: now, source: 'unsubscribe_link', ipAddress: <ip>, userAgent: <ua> }
  And renders HTML page (no auth required): "Te-ai dezabonat de la listele de marketing Amass CRM. Pentru a reveni, contactează contul tău Amass."
  And on invalid token: returns 404 (do NOT reveal which contact ids exist)
  And NO subsequent campaign send to this contact embeds tracking OR includes them in batch (filter at audience expansion time)
```

#### Scenario: IP/UA retention policy — 90 days then anonymize
```gherkin
Given EmailTrack rows older than 90 days exist with ipAddress + userAgent populated
When the daily BullMQ cron 'email-tracking.retention' fires at 03:00 Europe/Bucharest [propus]
Then for each row WHERE createdAt < now() - 90 days AND ipAddress IS NOT NULL:
  UPDATE email_tracks SET ipAddress = sha256(ipAddress || tenantId), userAgent = NULL WHERE id = <row>
  And the row is preserved (aggregate counts still work) but PII is stripped
  And the operation runs in batches of 1000 with statement_timeout = 30s
  And a Prometheus counter email_tracking_anonymized_total{tenantId} is incremented per batch
```

#### Scenario: Rate limit per pixel (DDoS / probe defense)
```gherkin
Given a single source IP fetches /api/v1/e/t/<id>/open.gif at >100 req/sec
When the throttler middleware (already wired per CLAUDE.md) sees the burst
Then requests beyond the limit return 429 { code: 'TOO_MANY_REQUESTS' } with Retry-After header
  And the limit is configurable: env.EMAIL_TRACKING_PIXEL_RATE = '60/minute' per IP, default value [propus]
  And legitimate Gmail image proxy bursts (which arrive as IP-distinct from Google's range) are NOT throttled in aggregate
```

#### Scenario: Cross-tenant denied — Tenant B cannot read Tenant A's tracking stats
```gherkin
Given tenant acme-ro has EmailMessage msg_abc123 with 5 opens, 2 clicks
  And user john@globex.com (tenant globex) authenticates with valid JWT
When john calls GET /api/v1/email/msg_abc123/tracking
Then the response is 404 { code: 'EMAIL_NOT_FOUND' }
  And the service does the lookup via prisma.emailMessage.findUnique then verifies tenantId matches ctx.tenantId
  And NO data leaks (not even existence)
  And the audit log records { action: 'CROSS_TENANT_READ_BLOCKED', table: 'email_messages', row_id: 'msg_abc123' }
```

### Story F1.2 — Marketing manager vede aggregated campaign stats

**As a** marketing manager `maria@acme.ro`
**I want** un dashboard cu open-rate + click-rate per campanie
**So that** știu care subject-line funcționează și care nu

#### Scenario: Campaign stats endpoint returns aggregates
```gherkin
Given campaign camp_q3 sent to 100 contacts, 100 EmailMessage rows created with status='SENT'
  And 47 of those messages have at least one EmailTrack { kind: 'OPEN' }
  And 12 of those messages have at least one EmailTrack { kind: 'CLICK' }
When maria@acme.ro calls GET /api/v1/campaigns/camp_q3/stats
Then the response is 200 with body:
  {
    "campaignId": "camp_q3",
    "sentCount": 100,
    "uniqueOpens": 47,
    "uniqueClicks": 12,
    "totalOpens": 89,        // sum across all opens including repeats
    "totalClicks": 15,
    "openRate": 0.47,        // uniqueOpens / sentCount, 2 decimal places
    "clickRate": 0.12,
    "clickToOpenRate": 0.255, // uniqueClicks / uniqueOpens
    "lastOpenAt": "2026-05-17T14:32:00Z",
    "lastClickAt": "2026-05-17T14:35:00Z",
    "trackingDisabled": false
  }
  And the query uses a single SQL aggregation (NOT N+1) via SELECT COUNT(DISTINCT message_id) FILTER (WHERE kind='OPEN') ...
  And p95 latency < 200ms for campaigns up to 10k recipients (measured via Pino timing log)
```

#### Scenario: Stats when campaign has zero sends yet (draft)
```gherkin
Given campaign camp_new has status='DRAFT' and sentCount=0
When maria calls GET /api/v1/campaigns/camp_new/stats
Then the response is 200 with { sentCount: 0, uniqueOpens: 0, uniqueClicks: 0, openRate: null, clickRate: null, clickToOpenRate: null }
  And null (NOT 0) is used for rate fields because "0% of 0 sent" is undefined, not zero
```

#### Scenario: Stats RBAC — VIEWER role allowed read-only
```gherkin
Given user observer@acme.ro has UserRole VIEWER
When observer calls GET /api/v1/campaigns/camp_q3/stats
Then the response is 200 with stats
  And VIEWER is in @Roles() list [verificat: matches existing pattern in campaigns.controller.ts]
```

### Non-functional F1
- **Coverage:** `email-tracking.service.ts` ≥80% line (existing test file present `[verificat]`). New code: `campaigns.service.ts` stats method, unsubscribe controller, retention processor — each ≥80%.
- **Audit log entries:** `email.tracking.skipped`, `email.unsubscribed`, `email_tracking.anonymized` (batch summary, not per-row).
- **Prometheus counters:** `email_opens_total{tenantId}`, `email_clicks_total{tenantId}`, `email_unsubscribes_total{tenantId}`, `email_tracking_anonymized_total{tenantId}`.
- **GDPR DPIA addendum:** update `docs/DPIA_TEMPLATE.md` with tracking-pixel legitimate-interest analysis. **Lawyer review required before prod** `[depășește contextul]`.

---

## Feature F2 — Drag-drop campaign builder

**Effort:** 14 zile (roadmap §2 P1). **Realitate adjusted:** schema additions + builder UI = biggest chunk. Backend send-pipeline already exists via `sendTransactional`.

### Schema additions `[propus]`

```prisma
model Campaign {
  // ... existing fields ...
  templateJson    Json?    @map("template_json")   // builder block tree
  subjectLine     String?  @db.VarChar(998) @map("subject_line")
  previewText     String?  @db.VarChar(255) @map("preview_text")
  senderAccountId String?  @map("sender_account_id")
  scheduledAt     DateTime? @map("scheduled_at")
  recipientFilter Json?    @map("recipient_filter") // ContactSegment filterJson snapshot
  // sentCount, conversions, revenue already exist
}

model CampaignRecipient {  // NEW
  id           String   @id @default(cuid())
  tenantId     String   @map("tenant_id")
  campaignId   String   @map("campaign_id")
  contactId    String   @map("contact_id")
  emailAddress String   @map("email_address")
  status       CampaignRecipientStatus @default(QUEUED)
  messageId    String?  @map("message_id")  // FK to EmailMessage once sent
  queuedAt     DateTime @default(now())
  sentAt       DateTime?
  failedAt     DateTime?
  errorMessage String?
  @@unique([campaignId, contactId])  // dedupe per send
  @@index([tenantId, campaignId, status])
  @@map("campaign_recipients")
}

enum CampaignRecipientStatus {
  QUEUED
  SENDING
  SENT
  FAILED
  SUPPRESSED  // contact unsubscribed before send
}
```

### Story F2.1 — Marketing manager construiește un email cu drag-drop

**As a** marketing manager `maria@acme.ro` cu skill set non-technical
**I want** să construiesc un email drag-drop cu blocks (heading, paragraph, image, button, divider, spacer)
**So that** nu trebuie să scriu HTML și pot face A/B testing rapid

#### Scenario: Create draft campaign with empty template
```gherkin
Given maria is on /campaigns and clicks "Campanie nouă"
When maria submits POST /api/v1/campaigns { name: 'Promo Q3 2026', channel: 'EMAIL' }
Then the response is 201 with { id: 'camp_q3', name: 'Promo Q3 2026', status: 'DRAFT', channel: 'EMAIL', templateJson: null, ... }
  And a row exists in campaigns: status='DRAFT', tenantId='acme-ro', createdById=maria.id
  And maria is redirected to /campaigns/camp_q3/edit which shows the empty canvas
```

#### Scenario: Add blocks via drag-drop, persist templateJson
```gherkin
Given maria is on /campaigns/camp_q3/edit
When maria drags a Heading block to the canvas, types "Salut, {{contact.firstName}}!"
  And drags a Paragraph block below, types "Oferta noastră de Q3..."
  And drags a Button block, sets URL "https://acme.ro/promo", label "Vezi oferta"
  And maria clicks "Salvează"
Then the FE serializes the canvas to JSON:
  {
    "version": 1,
    "blocks": [
      { "id": "blk_1", "type": "heading", "level": 1, "text": "Salut, {{contact.firstName}}!", "align": "left" },
      { "id": "blk_2", "type": "paragraph", "text": "Oferta noastră de Q3...", "align": "left" },
      { "id": "blk_3", "type": "button", "url": "https://acme.ro/promo", "label": "Vezi oferta", "align": "center" }
    ]
  }
  And calls PATCH /api/v1/campaigns/camp_q3 { templateJson: <above>, subjectLine: 'Oferta de Q3 doar pentru tine' }
  And the response is 200
  And the DB row campaigns.template_json equals the submitted JSON
  And NO rendered HTML is stored — HTML is computed at send-time from templateJson
```

#### Scenario: Block schema validated server-side (defense against malformed JSON)
```gherkin
When maria submits PATCH /api/v1/campaigns/camp_q3 { templateJson: { version: 1, blocks: [{ type: 'iframe', src: 'javascript:alert(1)' }] } }
Then the response is 400 { code: 'VALIDATION_ERROR', details: { 'templateJson.blocks[0].type': 'must be one of: heading, paragraph, image, button, divider, spacer' } }
  And the Zod schema in @amass/shared package rejects unknown block types
  And the DB row is unchanged
```

#### Scenario: Personalization tokens — supported list
```gherkin
Given templateJson contains text "Salut, {{contact.firstName}}!" and "Email: {{contact.email}}"
When the campaign is rendered for contact { firstName: 'John', lastName: 'Doe', email: 'john@globex.com', company: { name: 'Globex Corp' } }
Then the supported tokens are interpolated:
  | Token                         | Resolved value             |
  | {{contact.firstName}}         | John                       |
  | {{contact.lastName}}          | Doe                        |
  | {{contact.fullName}}          | John Doe                   |
  | {{contact.email}}             | john@globex.com            |
  | {{contact.company.name}}      | Globex Corp                |
  | {{campaign.name}}             | Promo Q3 2026              |
  | {{sender.firstName}}          | Maria                      |
  | {{sender.fullName}}           | Maria Popescu              |
  | {{unsubscribeUrl}}            | https://api.amasscrm.ro/api/v1/u/<token> |
  | {{currentYear}}               | 2026                       |
  And UNKNOWN tokens (e.g. {{contact.crm_xyz_custom}}) render as empty string AND emit warn log { msg: 'campaign.token.unknown', token: '...' }
  And tokens are HTML-escaped before interpolation (defense XSS): a contact named "<script>alert(1)</script>" renders as "&lt;script&gt;alert(1)&lt;/script&gt;"
```

#### Scenario: Live preview shows rendered HTML
```gherkin
Given maria's canvas has 3 blocks (above)
When maria clicks the "Previzualizare" tab
Then the FE calls POST /api/v1/campaigns/camp_q3/preview { sampleContactId?: 'cnt_demo' } (optional sample contact)
  And the API returns { html: '<html>...</html>', text: 'Salut, John!\n...' }
  And the preview pane renders the HTML in a sandboxed iframe (sandbox="allow-same-origin")
  And tokens use the sample contact (if provided) or placeholder strings ("[firstName]") if no sample
  And the preview is responsive: desktop / mobile toggle in the UI
```

### Story F2.2 — Send test to single recipient

**As a** marketing manager
**I want** să trimit campania-draft la propriul email înainte de batch send la 5000 contacts
**So that** verific dacă arată ok în Gmail, Outlook, Yahoo

#### Scenario: Send test happy path
```gherkin
Given camp_q3 has status='DRAFT' and templateJson is complete
  And maria has senderAccountId='acc_maria' (SMTP account configured)
When maria calls POST /api/v1/campaigns/camp_q3/send-test { toEmail: 'maria@acme.ro' }
Then the system renders templateJson → HTML using maria as the sample-contact context
  And calls EmailService.sendTransactional internally (NOT EmailService.send because send-test bypasses CampaignRecipient bookkeeping)
  And enqueues a BullMQ 'email' job with payload { emailMessageId, tenantId: 'acme-ro' }
  And the response is 202 ACCEPTED { messageId: 'msg_test_xyz', queuedAt: '...' }
  And the campaign's sentCount is NOT incremented
  And the test email subject is prefixed: "[TEST] Oferta de Q3 doar pentru tine"
  And tracking pixel IS embedded so maria can verify pixel works (different from real send only in subject prefix)
```

#### Scenario: Send test requires complete template
```gherkin
Given camp_q3 has templateJson=null OR subjectLine=null OR senderAccountId=null
When maria calls POST /api/v1/campaigns/camp_q3/send-test { toEmail: 'maria@acme.ro' }
Then the response is 400 { code: 'CAMPAIGN_INCOMPLETE', details: { missing: ['subjectLine', 'senderAccountId'] } }
  And NO email is queued
```

#### Scenario: Send-test rate limit per campaign
```gherkin
Given camp_q3 has had 5 send-test requests in the last 60 minutes
When maria attempts a 6th send-test
Then the response is 429 { code: 'TOO_MANY_REQUESTS', message: 'Max 5 test sends per campaign per hour', retryAfter: <seconds> }
  And this is per (campaignId, userId) — different users can each have 5 tests on the same campaign
```

### Story F2.3 — Schedule batch send via BullMQ

**As a** marketing manager
**I want** să programez send-ul la 09:00 Europe/Bucharest mâine
**So that** prospect-ul primește email-ul la o oră de business, nu la 02:00 noaptea

#### Scenario: Schedule a future send
```gherkin
Given camp_q3 is complete (template + subject + sender + recipientFilter set)
  And recipientFilter resolves to a ContactSegment of 247 contacts (after suppressing unsubscribed)
When maria calls POST /api/v1/campaigns/camp_q3/schedule { scheduledAt: '2026-05-18T09:00:00+03:00' }
Then the response is 200 with { id: 'camp_q3', status: 'ACTIVE', scheduledAt: '2026-05-18T06:00:00.000Z', recipientCount: 247 }
  And the audience is materialized NOW into campaign_recipients (one row per contact, status='QUEUED')
  And 247 EmailMessage rows are NOT yet created (those are created at send-time)
  And a BullMQ delayed job is enqueued: queue='email-campaign', name='campaign.send', payload={ campaignId }, delay = (scheduledAt - now) in ms [propus: new queue 'email-campaign' for batch orchestration]
  And the campaign status transitions DRAFT → ACTIVE [verificat: launch() method exists in campaigns.service.ts:24]
```

#### Scenario: Audience suppresses unsubscribed contacts
```gherkin
Given ContactSegment seg_promo includes 250 contacts
  And 3 of them have ConsentRecord { purpose: 'EMAIL_MARKETING', status: 'REVOKED' }
When the schedule audience materialization runs
Then 247 CampaignRecipient rows are inserted with status='QUEUED'
  And 3 CampaignRecipient rows are inserted with status='SUPPRESSED' (audit trail: we knew about them, we did NOT contact them)
  And the campaign.targetCount = 250, but the planned send is 247
```

#### Scenario: Per-tenant send rate limit applied at batch dispatch
```gherkin
Given the 'campaign.send' BullMQ job picks up campaign camp_q3 with 247 QUEUED recipients at scheduledAt
When the worker processes the campaign
Then it dispatches sends in batches respecting per-tenant rate: 50 emails/sec, burst 200 [propus: env.EMAIL_CAMPAIGN_RATE_PER_SEC=50, EMAIL_CAMPAIGN_BURST=200, default values]
  And each batch creates EmailMessage rows + enqueues per-message 'email' jobs (existing queue)
  And campaign.sentCount is incremented per successful per-message dispatch (atomic UPDATE ... SET sentCount = sentCount + 1)
  And no other tenant's campaign is starved — rate limit is per-tenant, not global
  And when all 247 dispatched, campaign.status transitions ACTIVE → COMPLETED
  And BullMQ event 'campaign.completed' fires → WebhookService.dispatch(tenantId, 'CAMPAIGN_COMPLETED', { campaignId, sentCount: 247 })
```

#### Scenario: Cancel scheduled campaign before send
```gherkin
Given camp_q3 has status='ACTIVE' and scheduledAt='2026-05-18T09:00+03:00' (future)
When maria calls PATCH /api/v1/campaigns/camp_q3 { status: 'PAUSED' }
Then the response is 200
  And the delayed BullMQ job is removed (search by jobId='campaign-send-camp_q3' and call remove())
  And CampaignRecipient rows with status='QUEUED' are deleted (or marked CANCELED — preserve audit) [propus: prefer CANCELED]
  And the campaign returns to PAUSED state, can be re-scheduled
```

#### Scenario: SMTP failure on one recipient does not halt batch
```gherkin
Given campaign worker is processing 247 recipients
  And recipient #50 has invalid email "broken@@invalid"
When the per-message 'email' job fails for that recipient
Then the EmailMessage.status = 'FAILED', errorMessage = 'SMTP error: ...'
  And CampaignRecipient.status = 'FAILED', errorMessage = same
  And processing CONTINUES with recipient #51
  And the batch completes with sentCount=246, plus 1 failed
  And the campaign reports { sentCount: 246, failedCount: 1 } in stats
```

### Story F2.4 — Cross-tenant isolation on campaign endpoints

#### Scenario: Cross-tenant denied — Tenant B cannot read Tenant A's campaigns
```gherkin
Given tenant acme-ro has campaign camp_q3 (5 recipients sent)
  And user john@globex.com is authenticated
When john calls GET /api/v1/campaigns/camp_q3
Then the response is 404 { code: 'CAMPAIGN_NOT_FOUND' }
  And the findFirst query filters by both id AND tenantId [verificat: campaigns.service.ts:81]
  And NO data leaks
```

#### Scenario: Cross-tenant denied — Tenant B cannot send-test to Tenant A's campaign
```gherkin
When john (tenant globex) calls POST /api/v1/campaigns/camp_q3/send-test { toEmail: 'john@globex.com' }
Then the response is 404 (not 403 — leak prevention)
  And NO email is queued
  And NO message lands in john's inbox
```

#### Scenario: Cross-tenant denied — Tenant B cannot include Tenant A's contacts in own campaign
```gherkin
Given tenant globex tries to set campaign.recipientFilter with contactIds belonging to acme-ro
When john calls POST /api/v1/campaigns/camp_globex/schedule
Then the audience materialization queries contacts under runWithTenant('globex') — RLS blocks acme-ro contacts at DB level
  And the resulting CampaignRecipient rows are zero for any leaked acme-ro contact id
  And the test E2E e2e/campaign.isolation.spec.ts asserts: setting contactIds=['cnt_acme_xxx'] in globex's campaign produces 0 valid recipients
```

### Non-functional F2
- **Coverage:** new `campaigns.service.ts` send-test, schedule, audience-materialize methods ≥80%; new `campaign-builder.processor.ts` ≥80%; new `template-renderer.ts` (Handlebars-style token interpolation with XSS-safe escaping) ≥90%.
- **Performance:** template render <100ms for templates with up to 50 blocks. Audience materialize <5s for 10k contacts.
- **A11y:** drag-drop canvas keyboard-accessible (use `@dnd-kit/core` which supports keyboard sensors). Each block can be added via "Add block" button + dropdown for users without pointer.
- **Audit:** `campaign.created`, `campaign.updated`, `campaign.scheduled`, `campaign.completed`, `campaign.test_sent`.
- **Prometheus:** `campaign_sends_total{tenantId, status}`, `campaign_recipients_suppressed_total{tenantId, reason}`.

---

## Feature F3 — Webhooks marketplace

**Effort:** 7 zile (roadmap §2 P1). **Realitate adjusted:** 3-4 zile. SSRF + HMAC + delivery + secret rotation ALREADY exist `[verificat]`. Gap: **DLQ retry orchestration via BullMQ** (current dispatch is in-process Promise.allSettled, no retry), **per-event toggle UI**, **test-fire endpoint**, **enum additions** (`EMAIL_OPENED`, `EMAIL_CLICKED`, `CAMPAIGN_COMPLETED`).

### Schema additions `[propus]`

```prisma
enum WebhookEvent {
  COMPANY_CREATED
  COMPANY_UPDATED
  CONTACT_CREATED
  DEAL_CREATED
  DEAL_STATUS_CHANGED
  INVOICE_ISSUED
  QUOTE_ACCEPTED
  CALL_COMPLETED
  APPROVAL_DECIDED
  EMAIL_OPENED         // new in Phase 1
  EMAIL_CLICKED        // new in Phase 1
  EMAIL_UNSUBSCRIBED   // new in Phase 1
  CAMPAIGN_SCHEDULED   // new in Phase 1
  CAMPAIGN_COMPLETED   // new in Phase 1
}

model WebhookDelivery {
  // existing fields ...
  nextAttemptAt DateTime? @map("next_attempt_at")  // for DLQ-style backoff
  // attempt field already exists
}
```

### Story F3.1 — Tenant admin registers a webhook subscription

**As a** tenant admin `admin@acme.ro`
**I want** să configurez un endpoint extern care primește notificări la `DEAL_CREATED`
**So that** îl pot conecta la Slack via Zapier și echipa vede dealuri noi în chat

#### Scenario: Create webhook subscription (happy path)
```gherkin
Given admin@acme.ro is logged in (role ADMIN)
When admin calls POST /api/v1/webhooks/endpoints { url: 'https://hooks.zapier.com/abc/xyz', events: ['DEAL_CREATED', 'DEAL_STATUS_CHANGED'] }
Then the SSRF validator runs [verificat:webhooks.service.ts:218]: hooks.zapier.com resolves to a public IP (e.g. 54.x.x.x), allowed
  And the response is 201 with { id: 'wh_abc', url: '...', events: [...], isActive: true, createdAt: '...', secret: '<24-byte-hex>' }
  And the secret is shown EXACTLY ONCE in this response — subsequent GET endpoints omit it [verificat:PUBLIC_ENDPOINT_SELECT]
  And one row exists in webhook_endpoints with tenantId='acme-ro'
  And audit log records { action: 'webhook.created', subjectType: 'webhook_endpoint', subjectId: 'wh_abc', metadata: { url, events } }
```

#### Scenario: SSRF rejected — private IP target
```gherkin
When admin calls POST /api/v1/webhooks/endpoints { url: 'http://10.0.0.5/webhook', events: ['DEAL_CREATED'] }
Then the response is 400 { code: 'BAD_REQUEST', message: 'Webhook URL must resolve to a public address' } [verificat:webhooks.service.ts:251]
  And NO row is inserted
```

#### Scenario: SSRF rejected — AWS metadata endpoint
```gherkin
When admin calls POST /api/v1/webhooks/endpoints { url: 'http://169.254.169.254/latest/meta-data/iam', events: ['DEAL_CREATED'] }
Then the response is 400 [verificat:isPrivateOrReservedIp 169.254.x.x blocked at webhooks.service.ts:333]
  And NO row is inserted
```

#### Scenario: SSRF rejected — DNS rebinding attack at delivery time
```gherkin
Given admin registered webhook wh_dns with url='https://attacker.com/hook' (attacker.com resolves to 1.2.3.4 at registration)
  And the row was accepted (1.2.3.4 is public)
When a DEAL_CREATED event fires 1 hour later
  And by then attacker.com DNS now resolves to 127.0.0.1
  And WebhooksService.deliver() runs
Then validateUrl() is re-invoked at delivery time [verificat:webhooks.service.ts:180]
  And the new DNS resolution (127.0.0.1) is rejected by isPrivateOrReservedIp
  And the deliver throws, the WebhookDelivery row is persisted with statusCode=null, responseBody='Webhook URL must resolve to a public address', success=false
  And NO HTTP request is made to 127.0.0.1 (CRM server's localhost)
```

#### Scenario: Userinfo in URL rejected
```gherkin
When admin calls POST /api/v1/webhooks/endpoints { url: 'https://user:pass@hooks.zapier.com/abc', events: [...] }
Then the response is 400 'Webhook URL must not contain credentials' [verificat:webhooks.service.ts:228]
```

#### Scenario: HTTP rejected in production
```gherkin
Given NODE_ENV='production'
When admin calls POST /api/v1/webhooks/endpoints { url: 'http://hooks.zapier.com/abc', events: [...] }
Then the response is 400 'Webhook URL must use HTTPS in production' [verificat:webhooks.service.ts:225]
```

### Story F3.2 — Webhook delivery with HMAC signature

#### Scenario: Successful delivery on DEAL_CREATED event
```gherkin
Given webhook wh_abc is active, subscribed to DEAL_CREATED
  And a sales rep creates a deal: POST /api/v1/deals { title: 'Acme Q3', value: 5000, currency: 'RON' }
When the deal is persisted
  And the deals.service.ts emits webhooksService.dispatch(tenantId, 'DEAL_CREATED', { dealId: 'deal_xyz', title: 'Acme Q3', value: 5000, currency: 'RON' })
Then WebhooksService asynchronously POSTs to https://hooks.zapier.com/abc/xyz with:
  Headers:
    Content-Type: application/json
    X-Amass-Signature: sha256=<hmac>     # hmac = HMAC_SHA256(endpoint.secret, body)
    X-Amass-Event: DEAL_CREATED
  Body:
    { "event": "DEAL_CREATED", "tenantId": "acme-ro", "timestamp": "2026-05-17T15:00:00.000Z", "data": { "dealId": "deal_xyz", ... } }
  And the request times out after 10s [verificat:webhooks.service.ts:267]
  And the response body is captured up to 2 KiB
  And a WebhookDelivery row is inserted: { endpointId: 'wh_abc', tenantId: 'acme-ro', event: 'DEAL_CREATED', payload: {...}, statusCode: 200, responseBody: '...', success: true, attempt: 1 }
```

#### Scenario: HMAC signature verifiable by receiver
```gherkin
Given the receiver implements signature check:
  expected_sig = "sha256=" + hmac_sha256(endpoint_secret, request.body)
  assert request.headers['X-Amass-Signature'] == expected_sig  // use timing-safe compare
When the CRM sends a webhook
Then the receiver's signature check PASSES (same algorithm, same secret, same body bytes)
  And this is verifiable via: take a captured delivery row, recompute HMAC locally, compare to delivered header
```

#### Scenario: Delivery failure → retry with exponential backoff via BullMQ DLQ
```gherkin
Given webhook wh_abc target endpoint returns 503
When the first delivery attempt fails [propus: refactor — move from in-process Promise.allSettled to BullMQ queue 'webhook-delivery']
Then a WebhookDelivery row is persisted: attempt=1, success=false, statusCode=503, nextAttemptAt=now+30s
  And BullMQ retries with backoff: 30s, 5min, 30min, 2h, 6h (5 total attempts) [propus default values]
  And each retry creates a NEW WebhookDelivery row (one row per attempt, not updated in place — audit trail)
  And after the 5th failed attempt, the job moves to DLQ 'webhook-delivery-dlq'
  And a Sentry alert fires: { tag: 'webhook-dlq', endpointId: 'wh_abc', event: 'DEAL_CREATED' }
  And the endpoint's isActive flag is NOT auto-disabled (admin decides via UI)
```

#### Scenario: Receiver returns 2xx — delivery marked success, no retry
```gherkin
Given endpoint returns 201 Created
When delivery completes
Then WebhookDelivery row has { statusCode: 201, success: true, attempt: 1 }
  And NO subsequent retry is enqueued
```

#### Scenario: Receiver returns 410 Gone — auto-disable endpoint (RFC-style explicit unsubscribe)
```gherkin
Given endpoint returns 410 Gone three consecutive times across different events
When the third 410 lands [propus: counter in delivery service]
Then WebhookEndpoint.isActive is set to false
  And audit log records { action: 'webhook.auto_disabled', subjectId: 'wh_abc', reason: 'HTTP_410_GONE_REPEATED' }
  And the tenant admin sees a banner: "Webhook wh_abc dezactivat automat — receiver returnează 410 Gone"
```

### Story F3.3 — Admin tests an endpoint and reviews delivery logs

#### Scenario: Test-fire endpoint sends sample payload
```gherkin
Given webhook wh_abc is configured for events [DEAL_CREATED]
When admin calls POST /api/v1/webhooks/endpoints/wh_abc/test [propus: new endpoint]
Then the system synthesizes a sample DEAL_CREATED payload:
  { "event": "DEAL_CREATED", "tenantId": "acme-ro", "timestamp": "<now>", "data": { "dealId": "test_xxx", "title": "Test deal from Amass CRM", "value": 1000, "currency": "RON", "_test": true } }
  And dispatches it through the SAME pipeline as production events (real HTTP POST to receiver, real HMAC, real WebhookDelivery row written)
  And the response is 202 { deliveryId: 'wd_test_xxx', message: 'Test delivery enqueued' }
  And the admin can poll GET /webhooks/endpoints/wh_abc/deliveries to see the result
```

#### Scenario: List recent deliveries
```gherkin
Given webhook wh_abc has 150 deliveries in the past 7 days
When admin calls GET /api/v1/webhooks/endpoints/wh_abc/deliveries
Then the response is 200 with an array of the most recent 100 [verificat:webhooks.service.ts:138, take: 100]
  And each item has { id, event, payload, statusCode, responseBody, attempt, success, createdAt }
  And rows are ordered by createdAt desc
  And cross-tenant: john@globex cannot list acme-ro's deliveries (existence-based 404 via get(endpointId) called first)
```

#### Scenario: DLQ visibility — UI panel shows failed deliveries with retry button
```gherkin
Given 3 deliveries for wh_abc are in DLQ (5 attempts exhausted)
When admin opens /settings/webhooks/wh_abc/deliveries in the FE
Then the panel shows a "Failed" tab with the 3 DLQ items
  And each row has a "Re-deliver" button
  And clicking it calls POST /api/v1/webhooks/deliveries/<id>/replay [propus: new endpoint]
  And the API verifies the delivery belongs to the requesting tenant
  And it re-enqueues a NEW WebhookDelivery (NOT mutating the historic row)
  And the response is 202 { newDeliveryId: 'wd_replay_xxx' }
```

#### Scenario: Replay attack defense — receiver-side responsibility documented
```gherkin
Given a malicious actor captures one valid webhook delivery (TLS-MITM)
When the actor replays the request to the receiver
Then the CRM cannot prevent receiver-side replay (this is RECEIVER's job — they should reject if X-Amass-Timestamp is too old)
  And the spec documents in docs/WEBHOOKS_INTEGRATION.md [propus]: "Verifică ca timestamp-ul din payload să fie în ultimele 5 minute pentru a respinge replay attacks"
  And the timestamp is ALREADY present in payload [verificat:webhooks.service.ts:158] body has 'timestamp' field
```

### Story F3.4 — Secret rotation

#### Scenario: Admin rotates webhook secret after suspected leak
```gherkin
Given webhook wh_abc has secret S1
When admin calls POST /api/v1/webhooks/endpoints/wh_abc/rotate-secret [verificat: endpoint exists]
Then the response is 200 with { id: 'wh_abc', secret: 'S2', rotatedAt: '...' }
  And S2 is shown exactly once in this response
  And S1 is no longer valid for NEW deliveries
  And in-flight deliveries (already-enqueued BullMQ jobs) signed with S1 STILL get sent with S1 — receiver must accept them OR fail (acceptable transient state)
  And audit log records { action: 'webhook.secret_rotated', subjectId: 'wh_abc' }
  And the FE shows a warning: "Salvează noua cheie acum — nu va mai fi afișată"
```

### Story F3.5 — Cross-tenant isolation on webhooks

#### Scenario: Cross-tenant denied — read another tenant's endpoint
```gherkin
Given acme-ro has webhook wh_acme
  And john@globex (tenant globex) is authenticated
When john calls GET /api/v1/webhooks/endpoints/wh_acme
Then the response is 404 'Webhook endpoint not found' [verificat:webhooks.service.ts:78]
  And NO row data leaks
```

#### Scenario: Cross-tenant denied — list does not leak other tenants
```gherkin
Given acme-ro has 3 endpoints, globex has 2 endpoints
When john@globex calls GET /api/v1/webhooks/endpoints
Then the response is 200 with EXACTLY 2 items (globex's only)
  And query is scoped via runWithTenant + tenantId filter [verificat:webhooks.service.ts:62-67]
```

#### Scenario: Cross-tenant denied — fire-event in tenant A does not deliver to tenant B's endpoint
```gherkin
Given acme-ro has wh_acme subscribed to DEAL_CREATED
  And globex has wh_globex subscribed to DEAL_CREATED
When a deal is created in tenant acme-ro
Then WebhooksService.dispatch is called with tenantId='acme-ro'
  And the internal sendToEndpoints query filters by tenantId='acme-ro' [verificat:webhooks.service.ts:153]
  And ONLY wh_acme receives the HTTP POST
  And wh_globex receives nothing
  And NO WebhookDelivery row is created under globex
```

### Non-functional F3
- **Coverage:** `webhooks.service.ts` ≥80% (existing spec present `[verificat]`). New code: BullMQ webhook-delivery processor ≥80%, replay endpoint ≥80%.
- **Performance:** dispatch enqueue <50ms (does NOT block the request that triggered it — fire-and-forget pattern verified `[verificat:webhooks.service.ts:146]`).
- **DLQ retention:** failed deliveries kept 30 days in webhook_deliveries, then archived to S3/MinIO + deleted from primary table [propus: cron job, separate from this spec scope but on Phase 1 backlog].
- **Audit:** `webhook.created`, `webhook.updated`, `webhook.deleted`, `webhook.secret_rotated`, `webhook.auto_disabled`, `webhook.delivery_replayed`.
- **Prometheus:** `webhook_deliveries_total{tenantId, event, status}`, `webhook_deliveries_in_dlq{tenantId}` (gauge).

---

## Non-functional acceptance — cross-cutting Phase 1

### Coverage (CLAUDE.md #8)
Modules touched in Phase 1 must MAINTAIN or IMPROVE current coverage. Critical-7 status — `email-tracking`, `campaigns`, `webhooks` are NOT in Critical-7 today, so target is ≥70% line (per CLAUDE.md "other modules ramp to ≥50% before GA"). Phase 1 raises the bar to ≥80% line on the new code paths because they handle external traffic + PII.

Run before any PR merge:
```
pnpm --filter @amass/api vitest run --config vitest.config.unit.ts --coverage \
  --reporter=verbose \
  apps/api/src/modules/{email-tracking,campaigns,webhooks}/
```

### Multi-tenant isolation (CLAUDE.md #3)
E2E test files required (all under `apps/api/test/`):
- `email-tracking.isolation.e2e.spec.ts` — covers F1 cross-tenant read of stats, recording for wrong tenant lookup, unsubscribe token leak to other tenant
- `campaigns.isolation.e2e.spec.ts` — cross-tenant read/update/delete/send-test/schedule/contact-include
- `webhooks.isolation.e2e.spec.ts` — list, get, dispatch fan-out scoping

Each MUST use `runWithTenant` boundaries and verify RLS at the DB level (not just service-layer filters).

### Security (CLAUDE.md #3 + `docs/SCALING.md` + OWASP top-10)
`security-red-team` sub-agent reviews:
- Pixel rate limit configured + load-tested at 1000 req/s from single IP
- HMAC sig verification timing-safe `[verificat:email-tracking.service.ts:235]`
- SSRF re-validation at delivery time `[verificat]`
- Unsubscribe token unguessable (HMAC + 32 hex chars = 128 bit entropy)
- XSS-safe template rendering (escape contact PII before interpolation)
- Campaign send rate limit per-tenant prevents one tenant DoS'ing another

### A11y (WCAG 2.1 AA)
- Campaign builder canvas: keyboard-navigable via `@dnd-kit/core` keyboard sensor + "Add block" fallback button. `aria-roledescription="sortable"` on each block.
- Webhook events checkbox grid: each checkbox has explicit `<label for>`, fieldset with legend "Selectează evenimentele de trimis".
- Webhook delivery list: `<table>` semantics, sortable headers have `aria-sort`.
- `accessibility-auditor` signs off in PR before merge.

### Performance budgets
- Open-pixel endpoint p95 <50ms (no DB write blocks response — could be async, but current sync implementation is acceptable at this scale `[verificat]`)
- Click endpoint p95 <100ms (one INSERT + 302)
- Stats aggregation p95 <200ms for campaigns up to 10k recipients
- Webhook dispatch enqueue <50ms; receiver call timeout 10s `[verificat]`
- Campaign batch send: 50 emails/sec/tenant sustainable, burst 200

### Observability
New counters / gauges (existing Prometheus registry, no new infra):
- `email_opens_total{tenantId}`, `email_clicks_total{tenantId}`, `email_unsubscribes_total{tenantId}`
- `email_tracking_anonymized_total{tenantId}` (batch retention)
- `campaign_sends_total{tenantId, status}`, `campaign_recipients_suppressed_total{tenantId, reason}`
- `webhook_deliveries_total{tenantId, event, status}` (status = 'success' | 'fail' | 'dlq')
- `webhook_deliveries_in_dlq{tenantId}` (gauge polled every 60s)

### Audit log entries (append-only)
Per `docs/SCALING.md` audit pattern:
- F1: `email.tracking.skipped`, `email.unsubscribed`, `email_tracking.anonymized` (batch)
- F2: `campaign.created`, `campaign.updated`, `campaign.scheduled`, `campaign.completed`, `campaign.canceled`, `campaign.test_sent`
- F3: `webhook.created`, `webhook.updated`, `webhook.deleted`, `webhook.secret_rotated`, `webhook.auto_disabled`, `webhook.delivery_replayed`
- F1 explicit NON-audit (high volume): individual `email.opened`, `email.clicked` events — these go to EmailTrack table only

### Definition of Done per feature (per CLAUDE.md #2)
1. Lint pass: `pnpm lint`
2. Unit + integration tests pass: `pnpm --filter @amass/api vitest run`
3. Coverage clears 80% on new service code
4. E2E smoke pass on staging including cross-tenant isolation tests
5. `code-reviewer` approves
6. `security-red-team` approves (SSRF + XSS + HMAC + rate-limit checklist)
7. `accessibility-auditor` approves campaign builder UI + webhook config UI
8. `docs/FEATURES.md` updated with F1/F2/F3 entries
9. `docs/WEBHOOKS_INTEGRATION.md` written for F3 (receiver-side spec) `[propus]`
10. CHANGELOG entry written
11. Conventional commit landed on `main`

---

## Pre-baked decisions (NO user sign-off needed — defaults applied)

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Send infrastructure | Keep Nodemailer-over-SMTP per-tenant `[verificat]` | Zero new vendor, no contract, tenant controls deliverability |
| D2 | Tracking pixel IP/UA retention | 90 days then `sha256(ip \|\| tenantId)` + drop UA | Audit-useful short term, GDPR-minimized long term |
| D3 | Webhook DLQ UI visibility | YES — FE panel + replay button | Transparency = trust |
| D4 | Campaign send rate (per-tenant) | 50/sec, burst 200, env-configurable | Conservative default; tenants on dedicated SMTP can request bump |
| D5 | From-address verification (DKIM) | Out of scope for Phase 1 — delegated to SMTP provider | CRM-side DKIM check = scope creep, SMTP provider already enforces |
| D6 | Webhook retry policy | BullMQ exponential 30s/5m/30m/2h/6h then DLQ | Standard 5-attempt envelope, matches GitHub/Stripe pattern |
| D7 | Test send rate limit | 5/hour per (campaignId, userId) | Prevents accidental spam from "stuck on test button" UX |
| D8 | Receiver 410 Gone auto-disable | After 3 consecutive 410s across events | RFC semantics — receiver explicitly signals "stop" |
| D9 | Unsubscribe footer | Only for campaign-driven sends, not 1-on-1 | 1-on-1 is transactional; CAN-SPAM/GDPR consent comes from sales context |
| D10 | EMAIL_OPENED / EMAIL_CLICKED webhook events | Add to enum + fire on each open/click | Closes the loop F1 → F3 so Zapier integrations work end-to-end |

---

## Decisions to flag for user sign-off (block work until answered)

| # | Topic | Options | Recommendation |
|---|---|---|---|
| Q1 | Tracking pixel — fire-once vs every-open | A: dedupe per (messageId, ipHash, day); B: log every fetch | **B** — Gmail proxy makes per-recipient dedup impossible; raw count is more honest. `[verificat: current code does B]` |
| Q2 | Campaign builder MJML vs hand-rolled HTML renderer | A: adopt MJML lib; B: write minimal renderer (`render(templateJson) → HTML`) | **B** — adding MJML = new deps + learning curve; we ship 6 block types, hand-roll renderer ≤500 LOC. Reconsider in Phase 3 if customers request HTML import. |
| Q3 | Webhook signature — include timestamp in signed payload | A: sign body only (current); B: sign `timestamp.body` | **B** — defeats replay even if receiver is naive. Breaking change to current consumers. **Need migration plan** if any webhook clients exist (zero in prod yet per `[verificat:branch is pre-launch]`). |
| Q4 | Campaign suppression list — also suppress on `EmailStatus.FAILED` history | A: only ConsentRecord REVOKED; B: also bounce-history (>3 hard bounces) | **B** — protect sender reputation, but requires bounce-classification logic. Could be Phase 2 polish. **Recommend A for Phase 1, B in Phase 2.** |
| Q5 | DKIM enforcement on `EmailAccount.fromEmail` | A: trust user; B: SPF/DKIM check at account create | **A for Phase 1** — SMTP provider enforces; revisit if deliverability issues arise. |

---

## Out of scope — DO NOT build in Phase 1

- **MJML or external HTML template import** — Phase 3 candidate, see Q2.
- **A/B testing on subject lines** — Phase 5 (Pipeline analytics tier).
- **Geo-location of opens / device-class detection** — privacy-cost not justified.
- **Click heatmaps** — UI complexity > value at this scale.
- **Bounce classification** (hard vs soft, mailbox-full, etc.) — Phase 2.
- **Webhook payload transformation / JSON path filtering** — receivers handle this; we send full payloads.
- **Webhook delivery on workflow steps** — Phase 3 workflow engine integrates with webhooks then.
- **OAuth-secured webhook destinations** (in addition to HMAC) — Phase 3 if enterprise demands.
- **Campaign templates library** (10 pre-built starters) — Phase 3 alongside workflow templates.
- **In-app open notifications** (toast "Cineva tocmai a deschis email-ul tău!") — Phase 4 mobile + push.
- **Email warm-up sequences** (gradually ramp send volume on new SMTP account) — Phase 5.
- **Recipient timezone-aware send** ("send at 09:00 in their local time") — Phase 5.

---

## RICE prioritization within Phase 1

| Feature | Reach (users/Q) | Impact | Confidence | Effort (weeks) | RICE |
|---|---|---|---|---|---|
| **F1 — Email tracking** | 100 (every sales user benefits per email sent) | 2 (high — directly drives follow-up decisions) | 90% (most code exists) | 0.8 | **225** |
| **F2 — Campaign builder** | 30 (marketing-savvy users, ~30% of tenants) | 2 (high — enables marketing motion) | 70% (new UI + schema) | 2.0 | **42** |
| **F3 — Webhooks marketplace** | 20 (technical users who want Zapier/n8n integration) | 2 (high — unlocks ecosystem) | 80% (most code exists) | 0.8 | **40** |

**Recommended sequence within Phase 1:**
1. **F1 ships first** — highest RICE, unblocks F3 (because `EMAIL_OPENED`/`EMAIL_CLICKED` events feed F3 webhooks).
2. **F3 ships second** — small effort, high reuse from existing code, becomes valuable once F1 events flow.
3. **F2 ships last** — largest effort, biggest UI build, depends on F1 for analytics value.

Parallel where possible: BE work on F3 schema enum additions can happen alongside FE work on F2 canvas. F1 stats endpoint can be parallel with F2 schema migration.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tracking pixel triggers GDPR complaint from EU contact | M | H | Granular ConsentRecord per-contact, footer unsubscribe one-click, DPIA addendum reviewed by lawyer before prod `[depășește contextul: legal review required]` |
| SMTP rate limits on tenant's provider cause campaign batch failures | H | M | Per-tenant rate config (D4), retry per-message via BullMQ, surface failures in campaign stats UI |
| Webhook DNS rebinding bypass | L | H | Re-validate at delivery + pin resolved IP `[verificat:webhooks.service.ts:180,273]` |
| Drag-drop canvas not keyboard-accessible | M | M | Use `@dnd-kit/core` keyboard sensor, add "Add block" button fallback, a11y audit pre-merge |
| Campaign send queue starves other tenants | L | H | Per-tenant rate limit + BullMQ worker concurrency cap |
| WebhookEvent enum migration breaks existing subscriptions | L | L | Adding enum values is additive; existing subscriptions ignore new events unless re-configured |
