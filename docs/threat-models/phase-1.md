# Phase 1 — STRIDE Threat Model

> Generated 2026-05-17 by `security-architect` agent · review owner: Radu
> Scope: ROADMAP_V2.md §2 Phase 1 (Engagement) — Email open/click tracking, Drag-drop campaign builder, Webhooks marketplace.
> Baseline (CLAUDE.md rule #3): JwtAuthGuard + RolesGuard + `TenantContextMiddleware` (ALS) → `runWithTenant()` on Prisma client with `tenantExtension()` → Postgres RLS via `SET LOCAL app.tenant_id` + `SET LOCAL ROLE app_user` → append-only audit log.
> Style anchored on [`docs/threat-models/phase-0.md`](./phase-0.md).

## Legend

- **Likelihood**: L (rare / requires insider or chained exploit), M (achievable by motivated tenant user), H (achievable by any authenticated user OR fully unauthenticated)
- **Impact**: L (annoyance / cosmetic), M (single-tenant data corruption, ops noise, fines per tenant), H (cross-tenant leak, money loss, regulatory breach, reputational hit at brand scale)
- **Risk = Likelihood × Impact**; H×H prioritized
- **Confidence markers** (per CLAUDE.md): `[verificat]` = checked with tool now, `[presupun]` = inference, `[propus]` = does not yet exist, must be built

## Current state (as-built, before Phase 1 work)

- `EmailMessage`, `EmailTrack`, `EmailTrackKind` models exist `[verificat: prisma/schema.prisma:773,815]`.
- `EmailTrackingController` exposes `GET /e/t/:id/open.gif` + `GET /e/t/:id/click` as `@Public()` `[verificat: email-tracking.controller.ts:24,42]`.
- HMAC click-URL signing **already shipped**, 64-bit truncated, constant-time verify `[verificat: email-tracking.service.ts:215-239]`; controlled by `EMAIL_TRACKING_REQUIRE_SIG` env (default strict).
- Open-pixel is **unsigned today** — anyone who knows a `messageId` can record an OPEN, and replays multiply infinitely. Phase 1 must close this.
- `Campaign` model exists `[verificat: schema.prisma:2273]` (status, channel, budget, counters) but has **no `templateJson` blob** and no block schema. `[propus]` for Phase 1.
- `WebhookEndpoint` + `WebhookDelivery` exist `[verificat: schema.prisma:1944,1960]`. `WebhooksService` has HMAC signature, SSRF defense + IP pinning + DNS-rebinding re-check, secret rotation `[verificat: webhooks.service.ts]`.
- **No outbox table, no BullMQ-backed retry, no DLQ today** `[verificat: grep -r outbox]`. `dispatch()` is `Promise.allSettled` fire-and-forget. Phase 1 must add reliable delivery.

---

## Feature 1 — Email open/click tracking

### Trust boundaries

1. **Recipient mail client → `/e/t/:id/open.gif`** — completely unauthenticated, hits a public URL. Body: HTTP headers (user-controlled IP via XFF chain, UA, Referer).
2. **Recipient mail client → `/e/t/:id/click?u=...&s=...`** — same as above; query string carries target URL + HMAC sig.
3. **Mail relay (Gmail / Outlook image proxy) → tracking URL** — the request the CRM sees is from `googleusercontent.com` or `outlook.com`, NOT from the recipient. Trust-boundary subtlety: any geo/IP inference is wrong.
4. **Outbound HTML rewriter → recipient** — BE injects pixel + rewrites anchors on send. Untrusted input: the user-authored email body (could include `<img>` tags from third-party origins, signed templates, etc.).
5. **Authenticated stats reader → `GET /email/:id/tracking`** — JWT-gated, but currently OPEN to all 5 roles incl. VIEWER `[verificat: email-tracking.controller.ts:64]`.

### Assets

| Asset | Type | Location |
|---|---|---|
| `EmailTrack(messageId, kind, ip, ua, createdAt)` | Postgres table | `prisma/schema.prisma:815` `[verificat]` |
| `EmailMessage(tenantId, ...)` linkage | Postgres | `prisma/schema.prisma:773` `[verificat]` |
| HMAC tracking secret | `env.JWT_SECRET` reused (domain-separated by `email-track:` prefix) | `email-tracking.service.ts:218` `[verificat]` |
| Tenant tracking opt-out flag | Tenant config row | `[propus]` — does not exist today `[verificat: no `trackingEnabled` field on Tenant]` |
| Per-recipient opt-out (unsubscribe-style) | Postgres | `[propus]` |
| Email footer unsubscribe link | Email template inclusion | `[propus]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-MAIL-S-01 | Spoofing | **Open-pixel ID spoofing**: pixel URL is `/e/t/:messageId/open.gif` with no signature. Attacker who scrapes any sent email (forwarded message in archive, support ticket attachment) extracts the `messageId` and `curl`s the URL 10k times → fabricated OPEN events distort sales reports + lead-scoring + AB-test outcomes. | `EmailTrack` rows | H | M | Add HMAC sig to open-pixel as well (mirror the click path): URL becomes `/e/t/:messageId/open.gif?s=<sig>` where sig = HMAC(JWT_SECRET, `email-open:${messageId}`). Unsigned legacy URLs accepted only when `EMAIL_TRACKING_REQUIRE_SIG=false`. Same `signTrackingUrl` helper, new domain prefix `email-open:` to keep the click and open secrets separate. |
| T-MAIL-S-02 | Spoofing | **HMAC token replay** — even with sig, the same signed URL is reusable forever. Recipient who opens email 100×, or Gmail image proxy re-fetches across sessions, produces 100 OPEN events. AB-test "engagement" metric inflated for whoever has the most curious recipients. | `EmailTrack` rows | H | M | (1) **Dedup window per (messageId, kind, ip-prefix/24, hour)** at write time via partial unique index OR application-level `INSERT ... ON CONFLICT DO NOTHING`; first open in window counts, rest are noise. (2) Distinguish "unique opens" (count distinct messageId) from "raw opens" (count rows) in stats endpoint — the spec talks about both. (3) Document explicitly that Gmail proxy caching means at most one open per Gmail recipient regardless. |
| T-MAIL-S-03 | Spoofing | **Recipient impersonation via forwarded email** — Alice forwards her marketing email to Bob; Bob's open pixel fires; CRM thinks Alice opened. Acceptable noise OR sales rep calls Alice based on false "high engagement" signal. | `EmailTrack` rows | M | L | Document as accepted residual (industry-standard limitation). Mitigation tier: include a coarse `recipientHash` (sha256(messageId|recipientEmail)[:8]) in the URL so per-recipient analytics is at least possible; do NOT include recipient email in the URL itself (T-MAIL-I-02). |
| T-MAIL-T-01 | Tampering | **Open-redirect via click endpoint** — already mitigated by HMAC sig + `isSafeHttpUrl` allowing only `http(s):` `[verificat: email-tracking.service.ts:124,200]`. Regression risk: if `EMAIL_TRACKING_REQUIRE_SIG` is flipped off, attacker who knows a `messageId` crafts `/e/t/<id>/click?u=https://phish` and CRM serves a 302 redirect from `app.amass-crm.com`. Phishers love this. | `/e/t/:id/click` redirect | L | H | (1) Make `EMAIL_TRACKING_REQUIRE_SIG=true` non-overridable in production (Zod env schema: `requireSig: z.literal('true').default('true')` in prod). (2) Audit-log every `email.click.rejected` for visibility. (3) Optional: reject targets where the host's eTLD+1 differs from a tenant-configured allow-list (deferred — false-positive prone). |
| T-MAIL-T-02 | Tampering | **Pixel URL host substitution** — attacker who crafts a phishing email containing `<img src="https://app.amass-crm.com/e/t/<their-own-messageId>/open.gif">` triggers the CRM to record an OPEN that they then use to "prove" engagement (CRM-as-oracle attack — abusing CRM as a free, reputable HTTP logger). | `EmailTrack` rows | L | L | Pixel rate-limit per messageId (T-MAIL-D-01) keeps damage small; document as accepted residual. Note: this is structurally the same as any image tracker on the web — CSP on third-party sites does not block recipient-side fetches. |
| T-MAIL-T-03 | Tampering | **HTML injection in outbound body** — `injectTracking()` runs `html.replace(/<a\b...>/gi, ...)` on user-authored body. If user-authored body contains a crafted anchor like `<a href="https://example/" onclick="...">`, the rewrite preserves the surrounding attributes (`pre` + `post`) verbatim → XSS payload survives. Also: regex can be fooled by CDATA, nested quotes, broken HTML. | Email body sent to recipients | M | M | (1) Replace regex with a real HTML parser server-side (e.g. `parse5` or `cheerio`) and rebuild anchors safely. (2) Strip `on*=` event handlers + `javascript:` URLs at the same pass (defense in depth — most mail clients block them, but Outlook desktop still surprises). (3) Sanitize body through DOMPurify-equivalent BEFORE storing as `EmailMessage.bodyHtml`. |
| T-MAIL-R-01 | Repudiation | Tenant claims they had opt-out enabled but pixel still fired; without per-send audit there's no way to prove which flag state was active at send-time. GDPR DPA fight. | Audit log | M | M | At send time, snapshot `(tenantTrackingEnabled, recipientHasOptedOut, footerUnsubLinkPresent)` into `EmailMessage.trackingSnapshot Json @db.Jsonb`. Emit `email.tracking.disabled_for_send {messageId, reason}` audit event when tracking is intentionally skipped. Retention 7y (matches billing/contract retention since this defends GDPR fines). |
| T-MAIL-R-02 | Repudiation | "I never received this email" claim from recipient; without immutable SMTP `Message-ID` + timestamp + delivery receipt → unresolvable. | `EmailMessage` | M | L | `EmailMessage.messageId` (SMTP header) already persisted `[verificat: schema.prisma:790]`; verify it is set on EVERY successful send (integration test). Add `email.sent.completed {messageId, smtpMessageId}` audit event. |
| T-MAIL-I-01 | Information disclosure | **PII leak via IP/UA storage** — current code stores `ipAddress` + `userAgent` raw on every open/click `[verificat: email-tracking.service.ts:89,148]`. GDPR Art. 5(1)(c) data-minimization principle: IP is personal data; storing it indefinitely for marketing analytics requires legal basis AND must be necessary. | `EmailTrack.ipAddress`, `userAgent` | H | H | (1) Default: **store only first /24 (IPv4) or /48 (IPv6) octet prefix** + UA family (e.g. "Chrome 130 / macOS"), NOT raw value. Build a `redactIp()` + `parseUaFamily()` helper. (2) Retention: hard-delete raw tracking rows after 90 days (cron job — `email.tracking.ttl_purge` event). (3) Opt-in toggle per tenant to keep full IP + UA for fraud investigation (must be documented in their DPA addendum). (4) `runWithTenant` already restricts cross-tenant reads — keep. |
| T-MAIL-I-02 | Information disclosure | **PII leak via tracking URL** — if URL contains recipient email (e.g., `?to=alice@evil.com`), the URL ends up in mail-client logs, browser history of anyone who hovers/copies, archived emails forwarded to 3rd parties. | Tracking URLs | M | M | URL contains only `messageId` + sig today `[verificat]`. ENFORCE this in code review checklist — Zod parse the `?u` query as URL; document "tracking URLs MUST be opaque IDs only" in `docs/SECURITY.md`. |
| T-MAIL-I-03 | Information disclosure | **Stats endpoint over-disclosure** — `GET /email/:id/tracking` is open to VIEWER role `[verificat: email-tracking.controller.ts:64]`. VIEWER might be a contractor or auditor who shouldn't see open/click patterns. Worse: if the endpoint ever leaks raw `EmailTrack` rows with IP/UA, the contractor sees PII. | `/email/:id/tracking` | M | M | (1) Restrict role to `OWNER, ADMIN, MANAGER, AGENT` — remove VIEWER (or gate behind explicit tenant setting). (2) Return aggregates only (counts + lastOpenedAt), never raw rows with IP/UA. **Already correct** `[verificat: email-tracking.service.ts:160-187]` — keep; add regression test. |
| T-MAIL-I-04 | Information disclosure | **Open-pixel oracle**: 200 vs 404 distinguishes "valid messageId" from "invalid messageId". Attacker enumerates cuid space (low entropy if `@default(cuid())` — cuid is 25 chars, ~125 bits, not enumerable, but `EmailMessage.messageId` SMTP header is leaky if set predictably). | Existence oracle | L | L | Current code always returns 200 with the GIF bytes regardless `[verificat: email-tracking.service.ts:98]` — correct, keep. Add comment so future-Radu doesn't "fix" this into a 404. |
| T-MAIL-D-01 | Denial of service | **Pixel flooding DoS** — botnet hits `/e/t/:id/open.gif` 100k req/sec. Each request: DB lookup + RLS-wrapped INSERT. Postgres connection pool exhausted → entire API down. | API host + DB | H | H | (1) Per-IP rate limit on tracking endpoints (separate throttler from auth endpoints): 60 req/min per IP per messageId, 600 req/min per IP overall. Implementation: `@Throttle()` decorator from `@nestjs/throttler` (already in stack per `docs/SCALING.md`). (2) Per-tenant cap: max 10k tracking writes/hour per tenant (above that, drop with `email.tracking.rate_limited` audit). (3) Pixel served from a CDN edge cache in front of API; only first hit per (messageId, ip/24, hour) is forwarded to origin — dedup at edge. (4) DB write is async via a Redis Streams buffer; pixel response is immediate. |
| T-MAIL-D-02 | Denial of service | **DB amplification via `EmailTrack` growth** — high-volume sender × 10k recipients × 5 opens each = 50k rows per campaign; over 1 year + 100 campaigns = 5M rows per tenant. `EmailTrack.@@index([tenantId, messageId, createdAt])` exists `[verificat: schema.prisma:827]` but partition is single-table → vacuum + index bloat. | Postgres `email_tracks` | M | M | (1) Daily/monthly Postgres partitioning on `email_tracks` by `createdAt` (declarative range partition); old partitions detach for cold archive. (2) 90d TTL purge from T-MAIL-I-01 caps growth anyway. (3) Use `INSERT ... ON CONFLICT DO NOTHING` for dedup (T-MAIL-S-02) — reduces row count materially. |
| T-MAIL-D-03 | Denial of service | **Slow-loris on pixel endpoint** — attacker opens 1000 TCP connections, sends headers slowly, never sends body; Node event loop blocked. | API process | L | M | Caddy in front terminates with reasonable timeouts; NestJS body-parser timeout `req.setTimeout(10_000)`. Verify Caddy `request_timeout` configured. |
| T-MAIL-E-01 | Elevation of privilege | **Cross-tenant write via spoofed messageId** — `recordOpen()` does `findUnique({where: {id: messageId}})` bypassing tenant filter `[verificat: email-tracking.service.ts:77]`, then calls `runWithTenant(message.tenantId, ...)` with the tenant from THAT row. Correct today, but fragile: if a future refactor passes `messageId` from query string into a tenant-checked path, an attacker could write a tracking row attributed to another tenant's message. | `EmailTrack` cross-tenant write | L | M | Keep the current pattern but **add comment** documenting the design invariant ("messageId is the source of tenantId for public tracking endpoints"). Add integration test: posting an open for tenant-A's messageId from tenant-B's session does NOT pollute tenant-B's stats. |
| T-MAIL-E-02 | Elevation of privilege | **GDPR fine = financial elevation** — tracking without lawful basis converts to a financial harm (per DSA + GDPR up to 4% global revenue) without any technical "privilege" change. | Tenant config | M | H | (1) `Tenant.emailTrackingEnabled Boolean @default(false)` `[propus]` — opt-in per tenant. (2) Tenant admin must accept legitimate-interest balancing test + confirm footer unsubscribe link present BEFORE flag flips true. (3) Recipient-level opt-out: `EmailUnsubscribe(tenantId, emailAddress, reason, optedOutAt)` table `[propus]`; check before injecting tracking. (4) Mandatory `List-Unsubscribe` + `List-Unsubscribe-Post` headers on every send (RFC 8058 one-click). (5) DPIA artifact in `docs/dpia/email-tracking.md` `[propus]`. |

### Controls to implement (Email tracking)

- [ ] Open-pixel HMAC sig (`email-open:` prefix), enforced in prod.
- [ ] `INSERT ... ON CONFLICT DO NOTHING` dedup per `(messageId, kind, ipPrefix, hourBucket)`.
- [ ] Replace `String.replace` regex in `injectTracking()` with `parse5`/`cheerio` HTML parser; strip `on*` handlers + `javascript:` URLs.
- [ ] `redactIp()` — store /24 (v4) or /48 (v6) prefix only; `parseUaFamily()` — keep family + major version only.
- [ ] 90-day TTL cron purge of raw `EmailTrack` rows; emit `email.tracking.ttl_purged` event.
- [ ] Postgres declarative partitioning on `email_tracks` (monthly).
- [ ] Throttler on `/e/t/*` — 60 req/min/IP per messageId, 600 req/min/IP global.
- [ ] `Tenant.emailTrackingEnabled` boolean, default `false`; UI consent gate before enabling.
- [ ] `EmailUnsubscribe` table + check before tracking injection on every send.
- [ ] `List-Unsubscribe` + `List-Unsubscribe-Post` headers on outbound emails (RFC 8058).
- [ ] Restrict `GET /email/:id/tracking` to `OWNER, ADMIN, MANAGER, AGENT` (drop VIEWER).
- [ ] Audit events: `email.tracking.disabled_for_send`, `email.tracking.rate_limited`, `email.tracking.ttl_purged`, `email.click.rejected`, `email.unsubscribe.recorded`, `tenant.email_tracking.toggled`.

---

## Feature 2 — Drag-drop email campaign builder

### Trust boundaries

1. **FE drag-drop UI → `PATCH /campaigns/:id` (`templateJson`)** — user-authored block tree (header/image/text/button/divider/social), each block carries user-controlled content + style props.
2. **`templateJson` → preview iframe (FE)** — same authored content rendered for live preview in the editor.
3. **`templateJson` → MJML/Handlebars render (BE)** — same blob converted to final HTML for SMTP send; personalization tokens (`{{contact.firstName}}`, `{{deal.amount}}`) resolved against tenant data at this step.
4. **Send-test endpoint → SMTP relay** — single-recipient render path; recipient address user-supplied.
5. **Batch-send endpoint → SMTP relay + bulk queue** — N×recipients, often thousands.
6. **From-address field → SMTP relay** — what shows in `From:` header; downstream DKIM/SPF validation depends on tenant owning the domain.

### Assets

| Asset | Type | Location |
|---|---|---|
| `Campaign.templateJson Json @db.Jsonb` | Postgres column | `[propus]` — not on Campaign today `[verificat: schema.prisma:2273]` |
| `Campaign.fromAddress String @db.VarChar(320)` | Postgres column | `[propus]` |
| `Campaign.subject String @db.VarChar(998)` | Postgres column | `[propus]` |
| `TenantSendingDomain(domain, dkimStatus, spfStatus, verifiedAt)` | Postgres | `[propus]` — domain verification required before allowing sender on that domain |
| Personalization token resolver | BE service | `[propus]` |
| Preview iframe sandbox | FE component | `[propus]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-CB-S-01 | Spoofing | **From-address spoofing** — tenant sets `fromAddress: "billing@stripe.com"` and sends phishing through our SMTP relay; DKIM signed by amass-crm.com but display name + From: spoofed; receivers' clients show "billing@stripe.com" in compact view. Brand & deliverability blast. | `Campaign.fromAddress` | H | H | (1) `TenantSendingDomain` verification mandatory: DNS TXT (`amass-verify=<random>`) + DKIM CNAME + SPF include verified BEFORE any send from that domain. (2) `fromAddress` must match `WHERE domain = split(fromAddress, '@')[1] AND verifiedAt IS NOT NULL AND tenantId = ctx.tenantId`. 400 otherwise. (3) Display name allow-list: regex `^[\p{L}\p{N}\s\-_.()]{1,80}$/u` — no `<>"'`. (4) Default unverified tenants send from `noreply@<tenant-slug>.send.amass-crm.com` and CANNOT override. |
| T-CB-S-02 | Spoofing | **Send-test impersonation** — user enters CEO's email as test recipient, crafts subject "URGENT: wire transfer", sends 1 "test" → free phishing from amass-crm.com infrastructure. | `POST /campaigns/:id/test-send` | H | H | (1) Send-test recipient MUST be in `User` table of the same tenant (verified email) — Zod check `await prisma.user.findFirst({where: {email, tenantId: ctx.tenantId}})`. (2) Cap 10 test sends/hour/user. (3) Add `[TEST]` prefix to subject + visible "this is a campaign preview" banner. (4) Audit `campaign.test_sent {recipientUserId}`. |
| T-CB-T-01 | Tampering | **Stored XSS in templateJson** — user injects `<script>alert(1)</script>` in a text block; preview iframe renders it; if iframe is same-origin or has access to parent cookie, account takeover. | Preview iframe + final email render | H | H | (1) **Preview iframe MUST be `sandbox="allow-same-origin"` NO — use `sandbox=""` (no allow-same-origin) + `srcdoc=` with sanitized HTML**. Different origin from app domain (`preview.amass-crm.com`). (2) BE Zod schema for each block type: `text` accepts `{markdown: z.string().max(10_000)}` only — Markdown rendered through `marked` + `DOMPurify` server-side, no raw HTML. (3) `image` accepts `{src: z.string().url(), alt: z.string().max(200)}` and `src` MUST be a presigned MinIO URL OR allow-list domain (`https://*.amass-crm.com`). (4) `button` accepts `{label, href, style}` — `href` validated as `https?://` (same logic as click tracking) and runs through tracking. (5) Server-side renderer uses Handlebars `{{var}}` (HTML-encoded), never `{{{var}}}`. (6) CSP on preview iframe: `default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'` (inline style is unavoidable in email templates but `script-src` stays denied). |
| T-CB-T-02 | Tampering | **Personalization token injection** — user puts `{{user.passwordHash}}` or `{{tenant.stripeApiKey}}` in a block; renderer happily walks the object graph and exfiltrates the secret in plaintext email. | Token resolver | M | H | (1) Allow-list of resolvable paths per token namespace: `contact.{firstName,lastName,email,company,jobTitle}`, `deal.{name,amount,currency,stage}`, `tenant.{name,brandName}`, `user.{firstName,lastName,email}` — anything else returns empty string with `email.personalization.unknown_token` audit event. (2) Renderer takes a pre-built typed object (not raw Prisma row): `{contact: pickContactSafe(contact), deal: pickDealSafe(deal), ...}` so even a bug in allow-list can't reach `passwordHash`. (3) Forbid nested traversal: `{{contact.address.street}}` requires explicit allow-list entry per leaf. |
| T-CB-T-03 | Tampering | **Prototype pollution via templateJson** — `{"__proto__": {"isAdmin": true}}` inside a block's `style` prop merged via lodash `merge` into a defaults object → pollutes Object.prototype globally for that worker process. | Block style merge logic | M | H | Same defense pattern as Phase 0 T-SV-T-02: reject `__proto__`, `prototype`, `constructor` keys at Zod parse time; use `Object.create(null)` or `structuredClone` for merges. Add ESLint rule banning `lodash.merge`/`defaultsDeep` in `apps/api/src/modules/campaigns/`. |
| T-CB-T-04 | Tampering | **SSRF via image block src** — user adds an `<img src="http://169.254.169.254/latest/meta-data/iam/security-credentials/">` block; FE preview fetches it (browser-side, harmless), BUT BE may pre-fetch images for "thumbnail in send-test confirmation modal" or for "image dimension check" — that fetch is server-side and hits AWS IMDS. | Image preview fetcher (server-side) | M | H | (1) Image src allow-list: presigned MinIO URLs of this tenant OR public CDN allow-list (`https://images.unsplash.com/*` if such integration ships). No arbitrary URLs. (2) If server-side image fetch is ever needed: use the same `isPrivateOrReservedIp` defense from `webhooks.service.ts:325` `[verificat]` — extract to shared util `apps/api/src/common/ssrf/`. |
| T-CB-T-05 | Tampering | **HTML smuggling via SVG block** — user uploads an SVG image; SVG can contain `<script>` and inline event handlers. Some mail clients (Apple Mail) execute SVG scripts. | Image upload | M | M | (1) MinIO upload allow-list MIME: `image/png`, `image/jpeg`, `image/gif`, `image/webp` only. NO `image/svg+xml`. (2) Magic-byte check (not just `Content-Type`) on upload — reuse existing attachment scanner. (3) Existing attachment hardening from Phase 0 attachments module — verify same path used. |
| T-CB-T-06 | Tampering | **Subject-line injection** — user puts `\nBcc: attacker@evil.com\n` in subject; if SMTP composer does header concat manually, attacker receives every send. | SMTP header | M | H | Use a real SMTP library (e.g. `nodemailer`) that does header encoding — never string-concat into raw SMTP headers. Zod on subject: `z.string().max(998).regex(/^[^\r\n ]*$/)`. |
| T-CB-R-01 | Repudiation | **Bulk send disowned** — user launches 100k-recipient blast, recipients complain, user claims "the template was changed by someone else after my approval". | Audit log | M | M | Audit events: `campaign.template.updated {oldHash, newHash, diff}`, `campaign.launched {launchedById, templateHash, recipientCountSnapshot}`. Snapshot the actual `templateJson` (hashed + last-N-bytes) into the audit metadata; retain 7y (marketing communication evidence). |
| T-CB-I-01 | Information disclosure | **Cross-tenant template leak** — user crafts `templateJson` referencing `{{contact.id}}` from a foreign tenant via a guessed UUID OR misuses a "template marketplace" feature that shares blocks across tenants. | Token resolver | L | H | Same defense as T-CB-T-02: renderer receives pre-built scoped object; resolver NEVER reaches outside the current `runWithTenant` context. Integration test: try to resolve token referencing other-tenant contact UUID → empty + audit event. |
| T-CB-I-02 | Information disclosure | **Recipient list leak via preview** — user adds preview block showing "this will be sent to X recipients including alice@…, bob@…" and that preview is shared via screenshot/email outside the tenant. | UI preview | L | L | Preview shows recipient COUNT, not addresses; sample recipient (one) only with explicit user click + audit `campaign.preview.recipient_revealed`. |
| T-CB-D-01 | Denial of service | **Mass-send abuse** — trial tenant imports 100k email list from a torrent leak, sends spam blast → IP reputation hit affects ALL paying tenants on same SMTP relay (shared SES/Mailgun pool). | Outbound IP reputation | H | H | (1) Per-tenant send quota by plan: free=0, trial=100/day, basic=5k/day, pro=50k/day. Enforced at queue enqueue, NOT at SMTP send (so we don't pay for outbound that gets rejected). (2) Trial tenants on a separate SMTP subaccount with isolated IP pool — reputation damage contained. (3) Recipient list import requires verification step: each address must have a prior interaction (existed in `Contact` table) OR pass through double-opt-in flow. (4) Spam-content classifier (keyword + Bayes) on `subject` + `templateJson` text blocks before launch; flag high-risk for manual review. (5) Abuse Bayes hits → `tenant.suspended.spam_risk` event + auto-pause. |
| T-CB-D-02 | Denial of service | **Renderer CPU exhaustion** — 10k recipients × heavy Handlebars/MJML render × heavy SVG → CPU pegged, queue backs up, other features starved. | BullMQ render worker | M | M | (1) Render is a dedicated BullMQ queue with concurrency cap per tenant (8). (2) Per-render timeout 5s; killed renders re-queued max 2 attempts. (3) MJML compilation cached by `hash(templateJson)` — N recipients = 1 compile + N personalization passes. (4) Block count cap in template: max 100 blocks, max 200KB serialized `templateJson`. |
| T-CB-D-03 | Denial of service | **Billion-laughs / zip-bomb in templateJson** — deeply nested block `{children: [{children: [...]}]}` to 1000 levels; renderer recurses → stack overflow. | Zod parse + renderer | L | M | (1) Zod schema `z.lazy(...)` with `.max(20)` recursion depth (custom check). (2) Total block count cap 100 (T-CB-D-02). (3) Renderer iterative (not recursive) where possible. |
| T-CB-E-01 | Elevation of privilege | **Tenant member without `MANAGER` role launches campaign** — DRAFT → ACTIVE transition currently checks NotFoundException but role check is at controller layer only `[verificat: campaigns.service.ts:24-40]`; if a bulk-launch endpoint exists in Phase 1 (`POST /campaigns/launch-many`), the per-request role might be missed. | Campaign launch | M | M | Document in `docs/ACCESS_CONTROL_MATRIX.md`: `campaign.launch` = `OWNER, ADMIN, MANAGER`. Add `@Roles()` to every campaign mutation endpoint; integration test exercises each role. |
| T-CB-E-02 | Elevation of privilege | **API-key abuse** — if Phase 1 ships an "API integration" path (Zapier-style) that lets external callers create + launch campaigns, an exposed API key = full spam capability. | API tokens | L | H | API tokens for `campaign.*` write ops MUST have separate scope (`campaigns:write`) NOT bundled with `read`. Send rate limits apply per API token. Token rotation enforced 90d. |

### Controls to implement (Campaign builder)

- [ ] `Campaign.templateJson Jsonb`, `fromAddress`, `subject`, `replyTo` columns.
- [ ] `TenantSendingDomain` model + DNS verification (DKIM CNAME, SPF include, TXT challenge).
- [ ] `fromAddress` validated against verified domains; default `noreply@<slug>.send.amass-crm.com` for unverified.
- [ ] Per-block Zod schemas in `packages/shared/src/email-blocks.ts` — strict, allow-list, max sizes.
- [ ] Block `text` rendered through `marked` + `DOMPurify` server-side; no raw HTML.
- [ ] `image.src` allow-list to presigned MinIO + explicit CDN allow-list.
- [ ] SVG mime type blocked; magic-byte check on upload.
- [ ] Preview iframe: cross-origin (`preview.amass-crm.com`), `sandbox=""`, `srcdoc=` with sanitized HTML, strict CSP `default-src 'none'`.
- [ ] Personalization token allow-list (`contact.*`, `deal.*`, `tenant.{name,brandName}`, `user.{firstName,lastName,email}`); pre-built typed scoped object, never raw Prisma row.
- [ ] Subject + display name regex; max 998 / 80 chars.
- [ ] Send-test recipient MUST be `User` of same tenant; 10/hour/user cap.
- [ ] Per-plan send quotas; trial tenants on isolated SMTP pool.
- [ ] Contact-list import requires double-opt-in or prior interaction.
- [ ] Spam classifier on subject + text blocks; high-risk pauses for review.
- [ ] Render worker: dedicated queue, concurrency cap 8/tenant, 5s timeout, MJML cache.
- [ ] `__proto__` / `prototype` / `constructor` rejection at Zod; banned `lodash.merge`.
- [ ] Audit events: `campaign.template.updated`, `campaign.launched`, `campaign.test_sent`, `campaign.preview.recipient_revealed`, `tenant.sending_domain.verified`, `tenant.suspended.spam_risk`, `email.personalization.unknown_token`.

---

## Feature 3 — Webhooks marketplace

### Trust boundaries

1. **Tenant user → `POST /webhooks/endpoints`** — user supplies destination URL + event subscription list. URL is the highest-risk surface (SSRF, host substitution, cred-in-URL).
2. **CRM internal event → outbox table → worker → tenant URL** — outbound HTTP to arbitrary external host; we must protect ourselves AND not leak data we shouldn't.
3. **Tenant URL response → CRM** — response body up to 2KB persisted in `WebhookDelivery.responseBody` `[verificat: webhooks.service.ts:187]`; could itself be malicious (XXE, JSON-billion-laughs).
4. **Logs panel → tenant admin** — reads `WebhookDelivery` rows including `payload`; payload may contain PII that the subscribing user shouldn't see.

### Assets

| Asset | Type | Location |
|---|---|---|
| `WebhookEndpoint(url, secret, events[], isActive)` | Postgres | `prisma/schema.prisma:1944` `[verificat]` |
| `WebhookDelivery(payload Json, statusCode, responseBody, attempt, success)` | Postgres | `prisma/schema.prisma:1960` `[verificat]` |
| `OutboxEvent(tenantId, event, payload, status, attempts, nextAttemptAt, lastError, deliveredAt)` | Postgres | `[propus]` — outbox table does NOT exist today `[verificat: grep -r outbox]` |
| `WebhookDelivery` DLQ status enum (`PENDING|DELIVERED|FAILED|DEAD_LETTER`) | Postgres enum | `[propus]` — currently only `success Boolean` |
| HMAC secret per endpoint | Postgres `secret String` | `webhooks.service.ts:50` `[verificat]` (24 random bytes, hex) |
| BullMQ webhook delivery queue | Redis | `[propus]` — currently fire-and-forget `Promise.allSettled` `[verificat: webhooks.service.ts:160]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-WH-S-01 | Spoofing | **Webhook source spoofing on receiver side** — recipient server thinks the request came from us (or anyone). Without verification, attacker who learns the format crafts fake events into the recipient's webhook URL. | Recipient verification | M | H | HMAC `X-Amass-Signature: sha256=<hex>` already implemented `[verificat: webhooks.service.ts:170,183]`. **Gap:** missing `X-Amass-Timestamp` + signing over `timestamp + body`. Without timestamp, captured request is replayable forever. Mitigation: header `X-Amass-Timestamp: <unix-ms>`; sig becomes `HMAC(secret, timestamp + '.' + body)`; receivers reject `\|now - timestamp\| > 5min`. Document this in tenant-facing webhook docs with verification snippet. |
| T-WH-S-02 | Spoofing | **Cross-tenant webhook URL** — tenant A registers webhook URL `https://victim-tenant.amass-crm.com/api/v1/internal` → CRM POSTs to its own surface authenticated by source IP. SSRF via own infrastructure (server-side request forgery + host enumeration). | `WebhookEndpoint.url` | M | H | (1) Block any URL whose host ends with `amass-crm.com` (or our prod domain list) at validation. (2) Internal API endpoints (`/api/v1/internal/*`) require mTLS or service token, not IP-based trust. (3) Egress firewall (in deploy infra) blocks outbound to `app.amass-crm.com` from worker pods. Defense in depth. |
| T-WH-T-01 | Tampering | **DNS rebinding** — host resolves to public IP at create() time, flips to 127.0.0.1 at delivery time. | Outbound HTTP | M | H | Already mitigated: `validateUrl()` runs again at delivery + pins IP via `pinnedAddress` `[verificat: webhooks.service.ts:180,254]`. Keep + add regression test: register URL whose DNS TTL flips between create + dispatch, assert delivery uses pinned IP. |
| T-WH-T-02 | Tampering | **DLQ poisoning** — attacker (compromised tenant member) triggers many events that they know will fail at the receiver (e.g., they intentionally make their own webhook URL return 500); DLQ grows unbounded, takes up disk, masks legitimate failures. | DLQ table | M | M | (1) Per-(tenant, endpoint) DLQ cap: 1000 entries; on overflow, oldest are hard-deleted. (2) Endpoints with >X failures in window auto-disabled (`isActive=false`) + `webhook.endpoint.auto_disabled` audit event. (3) Endpoint deletion cascades to DLQ rows. |
| T-WH-T-03 | Tampering | **HMAC secret rotation race** — tenant rotates secret while in-flight deliveries hold old secret in memory; downstream rejects them; same event sent again with new secret; receiver sees duplicate event different sig. | Secret rotation | M | M | (1) Maintain `secret` + `previousSecret` + `previousSecretExpiresAt` columns; receivers accept either for grace window (24h). (2) Rotation endpoint sets `previousSecret = secret`, generates new `secret`, sets expiry. (3) Document overlap window in tenant rotation docs. (4) Audit `webhook.endpoint.secret_rotated`. |
| T-WH-T-04 | Tampering | **Response-body poisoning** — receiver returns a 10MB JSON, billion-laughs XML, or gzip bomb; current code caps response at 2KB `[verificat: webhooks.service.ts:187,294-301]`. Verify cap is applied **before** any JSON.parse / decompression. | Response handling | L | M | Cap is correct + applied during stream `[verificat]`. Add: do NOT call `JSON.parse(responseBody)` anywhere — store as raw string only. Add: disable automatic gzip/deflate decompression OR cap decompressed size. |
| T-WH-T-05 | Tampering | **Outbox event replay before idempotency** — without an outbox table today, dispatch is fire-and-forget; if BE crashes mid-dispatch, event lost OR partially delivered (some endpoints got it, some didn't). | Delivery semantics | H | H | **Phase 1 must add an `OutboxEvent` table** (per CLAUDE.md architecture mandate "Outbox pattern → Redis Streams. Idempotent consumers"). Pattern: 1) writer commits domain change + INSERT INTO outbox in SAME tx (RLS-scoped); 2) BullMQ poller picks up `status=PENDING`; 3) for each matching endpoint, attempt deliver, mark `status=DELIVERED` or schedule next attempt with `nextAttemptAt = now() + backoff`. Idempotency key per delivery = `(outboxEventId, endpointId)`. Receiver gets `X-Amass-Event-Id: <outboxEventId>` header so they can dedup on their side. |
| T-WH-R-01 | Repudiation | "We never received this event" — receiver claims; without immutable delivery log + receiver's response signature, dispute unresolvable. | Audit log + WebhookDelivery | M | M | `WebhookDelivery` already captures `statusCode + responseBody + attempt + success` `[verificat]`. Add: `signatureSent`, `headersSent` Json, `responseHeaders` Json (truncated), `durationMs`. Retain 90d for ops, then archive monthly summary. Audit event `webhook.delivery.attempted` with `eventId, endpointId, attempt, status`. |
| T-WH-I-01 | Information disclosure | **Webhook secret leak via list endpoint** — already fixed: `PUBLIC_ENDPOINT_SELECT` excludes secret `[verificat: webhooks.service.ts:28]`. Regression risk: future devs accidentally include `secret` in DTO. | List response | L | H | Keep `PUBLIC_ENDPOINT_SELECT` pattern. Add ESLint rule banning `select: { ...secret: true }` outside `rotateSecret`/`create` flows in webhooks module. |
| T-WH-I-02 | Information disclosure | **Cross-tenant payload leak** — webhook URL points to recipient that logs everything publicly (Pipedream's "free request bin" feature); if payload contains PII of tenant's contacts, that data ends up indexed by Google. | Payload contents | M | M | (1) Document in tenant-facing docs: "do NOT subscribe public/unauthenticated URLs to events containing PII". (2) For PII-heavy events (e.g., `CONTACT_CREATED`), include only IDs in payload by default; require explicit `includePersonalData: true` opt-in per endpoint with confirmation modal. (3) Audit `webhook.endpoint.pii_optin_enabled`. |
| T-WH-I-03 | Information disclosure | **Logs panel leaks payload to wrong role** — `listDeliveries` is in webhooks module; if controller does not gate on role, VIEWER or AGENT could read all `WebhookDelivery.payload` which may contain financial / PII data. | `GET /webhooks/:id/deliveries` | M | H | Gate `OWNER, ADMIN` only on `listDeliveries`. Document in `docs/ACCESS_CONTROL_MATRIX.md`. Mask sensitive fields in payload preview (show first/last 20 chars, hide middle for fields tagged sensitive). |
| T-WH-I-04 | Information disclosure | **Open-redirect via Location header** — current code passes `redirect: 'error'` in fetch path `[verificat: webhooks.service.ts:268]` BUT the pinned-IP `httpsRequest` path does NOT explicitly handle redirects; node default is no auto-follow but Location is in response. If a later refactor enables auto-follow, attacker who controls webhook receiver returns `302 Location: http://169.254.169.254/...` and CRM follows to AWS IMDS. | Response handling | L | H | Explicit `// DO NOT FOLLOW REDIRECTS` comment + assert `res.statusCode < 300 \|\| res.statusCode >= 400` in success criteria. If redirects ever needed: validate Location through `validateUrl()` again. |
| T-WH-D-01 | Denial of service | **Slow receiver** — receiver hangs the connection for 60s; current code has `signal: AbortSignal.timeout(10_000)` on fetch path AND `timeout: 10_000` + `req.on('timeout', ...)` on pinned-IP path `[verificat: webhooks.service.ts:267,288,312]`. | Worker thread | M | M | Already correctly bounded. Add: per-endpoint sliding-window concurrency cap (max 5 in-flight) to keep one bad receiver from blocking siblings. |
| T-WH-D-02 | Denial of service | **Exponential retry storm after outage** — receiver down for 1 hour; 100k events pile up; receiver back up; all 100k retried at same time → DDoS the receiver (and our worker pool). | Retry scheduling | M | M | (1) Exponential backoff with jitter: `delay = min(60s * 2^attempt, 1h) + random(0, 30s)`. (2) Per-(tenant, endpoint) concurrency cap (T-WH-D-01). (3) After 5 failed attempts: move to DLQ with `nextAttemptAt = NULL`, manual replay only. |
| T-WH-D-03 | Denial of service | **Massive payload from receiver** — receiver responds with 1GB body; cap at 2KB is correct `[verificat]`. Ensure stream truncation happens at network level (don't buffer 1GB then slice). | Response handling | L | M | Code uses chunk-by-chunk capture with `captured >= 2000` early-stop `[verificat: webhooks.service.ts:296-301]`. Correct. Add test: receiver streams 100MB, response handler stops reading after 2KB and closes connection. |
| T-WH-D-04 | Denial of service | **DLQ admin endpoint amplifier** — admin clicks "Retry all DLQ" → 10k events resubmitted in one tx → worker pool saturated. | DLQ replay | L | M | DLQ replay endpoint requires explicit batch size (default 100, max 1000) and emits `webhook.dlq.replayed {batchSize}` audit event. |
| T-WH-E-01 | Elevation of privilege | **API-token-based webhook creation bypasses MFA** — if API tokens can create webhook endpoints, an attacker with a leaked token registers a webhook subscribed to `CONTACT_CREATED` and exfiltrates every new contact to their server. | API tokens | L | H | (1) `webhook.endpoint.create/update/delete` require interactive session OR API token with explicit `webhooks:admin` scope. (2) New webhook creation triggers email to all tenant OWNERs (out-of-band alert: "a new webhook was registered: <url>, events: [...]"). (3) Audit `webhook.endpoint.created` with full details + retention 7y. |
| T-WH-E-02 | Elevation of privilege | **Webhook event payload exposes more than intended** — e.g., `INVOICE_ISSUED` payload includes `payment.stripeCustomerToken` because the serializer dumps the whole Prisma row. Receiver now holds a token that could be used in subsequent attacks against the tenant's Stripe account. | Payload schema | M | H | Per-event payload schema in `packages/shared/src/webhook-payloads.ts` — strict allow-list of fields per event. Schema versioning (`X-Amass-Schema-Version: 1`). Integration test: dump payload for each event type, assert it matches the documented schema (no extra fields). OWASP API #3 "broken object property level authorization" defense. |

### Controls to implement (Webhooks)

- [ ] **Add `OutboxEvent` table** with `(id, tenantId, event, payload Json, status, attempts, nextAttemptAt, lastError, createdAt, deliveredAt)` and partial index `WHERE status = 'PENDING'`.
- [ ] BullMQ queue `webhook-delivery` with per-(tenant, endpoint) concurrency cap; deterministic `jobId = '${outboxEventId}:${endpointId}'`.
- [ ] Exponential backoff with jitter; max 5 attempts; move to `DEAD_LETTER` status.
- [ ] `X-Amass-Timestamp` + sig over `timestamp + '.' + body` (replay defense, 5-min skew window).
- [ ] `X-Amass-Event-Id` header for receiver-side dedup.
- [ ] `previousSecret` + `previousSecretExpiresAt` columns; secret rotation grace 24h.
- [ ] Block `*.amass-crm.com` host in `validateUrl()` (self-SSRF defense).
- [ ] DLQ admin endpoints: list (paginated, 100/page), replay (max batch 1000), delete; gated `OWNER, ADMIN`.
- [ ] `listDeliveries` gated `OWNER, ADMIN`; payload sensitive-field masking.
- [ ] Per-event payload Zod schema in `packages/shared/src/webhook-payloads.ts`; allow-list, no extra fields.
- [ ] PII-heavy events default to ID-only payload; `includePersonalData` opt-in per endpoint.
- [ ] New endpoint creation triggers OWNER email alert (out-of-band).
- [ ] Audit events: `webhook.endpoint.created`, `webhook.endpoint.updated`, `webhook.endpoint.deleted`, `webhook.endpoint.auto_disabled`, `webhook.endpoint.secret_rotated`, `webhook.endpoint.pii_optin_enabled`, `webhook.delivery.attempted`, `webhook.delivery.failed`, `webhook.delivery.dead_lettered`, `webhook.dlq.replayed`.

---

## Cross-feature residual risks

| ID | Risk | Why we accept it (Phase 1) |
|---|---|---|
| R-XF-01 | Gmail/Outlook image proxy caches one OPEN per recipient regardless of dedup; we cannot distinguish "did not open" from "opened but proxy cached". | Industry-standard. Document in user-facing metrics doc: "open rate is a floor estimate, not exact." |
| R-XF-02 | Once a tracking URL is in a recipient's inbox, that recipient could share/forward it intentionally — additional opens are forever attributable to the recipient (even if forwarded). | Acceptable; OPEN dedup at /24 + hour bucket limits damage to ~1 false signal per forwarder. |
| R-XF-03 | Webhook receivers can sell/leak the events we send them; we cannot revoke after delivery. | Documented in DPA: tenant is data controller for what they do with webhook payloads. Recommend opt-in PII-only mode (T-WH-I-02). |
| R-XF-04 | Self-hosted Email-tracking pixel cannot defeat clients that strip remote images by default (Apple Mail Privacy Protection pre-fetches everything → false 100% open rate from Apple devices). | Acceptable; document in metrics doc + add "Apple MPP detected" filter in dashboard (UA = `iCloud/*` family). |
| R-XF-05 | Outbox table grows unbounded if no archival cron. | Archive cron: monthly, move `status=DELIVERED` rows older than 90d to cold storage (S3 partition); raw outbox stays in Postgres only for ops/replay window. |

---

## Concrete TODO for `backend-engineer` (ordered, pre-merge mandatory)

Highest risk first (H×H) → then H×M → then M×M. Each item references the threat ID above.

### Block-merge (H×H or chain to H×H)

- [ ] **T-CB-S-01 + T-CB-S-02** — `TenantSendingDomain` model + DNS verification flow; `fromAddress` matched against verified domains; send-test recipient must be `User` of same tenant; default sender locked to `noreply@<slug>.send.amass-crm.com` for unverified.
- [ ] **T-CB-T-01** — Per-block Zod schemas in `packages/shared/src/email-blocks.ts`; server-side Markdown→sanitized HTML pipeline; image src allow-list; preview iframe at `preview.amass-crm.com` with `sandbox=""` + strict CSP.
- [ ] **T-CB-T-02** — Personalization token allow-list; pre-built typed scoped object passed to renderer; nested traversal forbidden unless explicit allow-list entry.
- [ ] **T-CB-T-03** — Reject `__proto__`, `prototype`, `constructor` at Zod parse; ban `lodash.merge`/`defaultsDeep` in `apps/api/src/modules/campaigns/`.
- [ ] **T-CB-T-06** — Subject regex `/^[^\r\n ]*$/`, max 998; SMTP via library (nodemailer), never raw header concat.
- [ ] **T-CB-D-01** — Per-plan send quotas at enqueue; trial tenants on isolated SMTP pool; contact list double-opt-in or prior-interaction gate.
- [ ] **T-MAIL-S-01** — HMAC sig on open-pixel (`email-open:` domain prefix); `EMAIL_TRACKING_REQUIRE_SIG` forced `true` in prod via Zod env.
- [ ] **T-MAIL-I-01** — `redactIp()` / `parseUaFamily()` redaction at write; 90d TTL purge cron.
- [ ] **T-MAIL-E-02** — `Tenant.emailTrackingEnabled` opt-in toggle + `EmailUnsubscribe` table + `List-Unsubscribe` header + DPIA artifact.
- [ ] **T-WH-T-05** — `OutboxEvent` table + BullMQ poller + idempotent delivery; eliminate fire-and-forget `Promise.allSettled` pattern in `dispatch()`.
- [ ] **T-WH-S-01** — `X-Amass-Timestamp` header + sig over `timestamp.body`; 5-min receiver skew window; document verification snippet.
- [ ] **T-WH-S-02** — Block `*.amass-crm.com` (and prod domain list) in `validateUrl()`.
- [ ] **T-WH-E-02** — Per-event payload Zod schemas in `packages/shared/src/webhook-payloads.ts`; integration test asserts no extra fields.

### High priority (H×M or M×H)

- [ ] **T-MAIL-S-02** — Dedup `(messageId, kind, ipPrefix, hourBucket)` via partial unique index + `INSERT ON CONFLICT DO NOTHING`; expose "unique vs raw" in stats.
- [ ] **T-MAIL-T-03** — Replace `String.replace` regex with `parse5`/`cheerio` HTML parser in `injectTracking()`; strip `on*` handlers + `javascript:` URLs.
- [ ] **T-MAIL-D-01** — `@Throttle()` on `/e/t/*` routes (60/min/IP per messageId, 600/min/IP global); CDN edge cache dedup; async DB write via Redis Streams buffer.
- [ ] **T-MAIL-I-03** — Drop VIEWER from `/email/:id/tracking`; regression test asserts only aggregate counts returned.
- [ ] **T-CB-T-04 + T-CB-T-05** — Extract `isPrivateOrReservedIp` to `apps/api/src/common/ssrf/`; image MIME allow-list (no SVG); magic-byte check on upload.
- [ ] **T-CB-D-02** — Render BullMQ queue with concurrency cap 8/tenant, 5s timeout, MJML compile cache.
- [ ] **T-WH-T-02** — Per-(tenant, endpoint) DLQ cap 1000; auto-disable endpoint after X failures.
- [ ] **T-WH-T-03** — `previousSecret` + 24h grace; rotation endpoint preserves overlap.
- [ ] **T-WH-I-02** — PII-heavy events default to ID-only payload; `includePersonalData` opt-in.
- [ ] **T-WH-I-03** — Gate `listDeliveries` to `OWNER, ADMIN`; sensitive field masking.
- [ ] **T-WH-E-01** — OWNER email alert on new webhook creation; `webhooks:admin` scope on API tokens.

### Medium priority (M×M)

- [ ] **T-MAIL-T-01** — Zod-pin `EMAIL_TRACKING_REQUIRE_SIG = 'true'` in prod env schema; audit `email.click.rejected`.
- [ ] **T-MAIL-D-02** — Postgres declarative partitioning on `email_tracks` (monthly).
- [ ] **T-MAIL-E-01** — Comment design invariant on `recordOpen()`; cross-tenant integration test.
- [ ] **T-CB-T-06** — Subject Zod regex (already listed in block-merge).
- [ ] **T-CB-R-01** — Audit `campaign.template.updated {oldHash, newHash}`, `campaign.launched {templateHash}`.
- [ ] **T-WH-D-02** — Exponential backoff + jitter; max 5 attempts; move to `DEAD_LETTER`.
- [ ] **T-WH-T-04** — Verify response cap applied at stream level; never `JSON.parse(responseBody)`; disable auto-decompression.
- [ ] **T-WH-I-04** — Comment + assert no auto-follow in pinned-IP `httpsRequest` path.
- [ ] **T-WH-R-01** — Persist `signatureSent`, `headersSent`, `responseHeaders`, `durationMs` on `WebhookDelivery`.

### Low priority (L×H or chain)

- [ ] **T-MAIL-T-02** — Document open-pixel-as-oracle accepted residual.
- [ ] **T-MAIL-I-04** — Comment "always 200" invariant on pixel handler.
- [ ] **T-CB-I-01 + T-CB-I-02** — Cross-tenant resolver integration test; recipient list preview shows count only.
- [ ] **T-CB-E-02** — `campaigns:write` API scope separation; 90d token rotation.
- [ ] **T-WH-I-01** — ESLint rule banning `secret: true` in select clauses outside `rotateSecret`/`create`.

---

## AUTHZ matrix delta (update `docs/ACCESS_CONTROL_MATRIX.md`)

| Operation | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|---|---|---|---|---|
| `email.tracking.stats.read` | x | x | x | x | — (removed) |
| `tenant.email_tracking.toggle` | x | — | — | — | — |
| `tenant.sending_domain.add` | x | x | — | — | — |
| `tenant.sending_domain.verify` | x | x | — | — | — |
| `campaign.create` | x | x | x | — | — |
| `campaign.update` | x | x | x | — | — |
| `campaign.launch` | x | x | x | — | — |
| `campaign.test_send` | x | x | x | x | — |
| `campaign.delete` | x | x | — | — | — |
| `webhook.endpoint.create` | x | x | — | — | — |
| `webhook.endpoint.update` | x | x | — | — | — |
| `webhook.endpoint.delete` | x | x | — | — | — |
| `webhook.endpoint.rotate_secret` | x | x | — | — | — |
| `webhook.delivery.list` | x | x | — | — | — |
| `webhook.dlq.replay` | x | x | — | — | — |

---

## Audit events delta (`apps/api/src/modules/audit/audit-events.ts`)

- `email.tracking.disabled_for_send`
- `email.tracking.rate_limited`
- `email.tracking.ttl_purged`
- `email.click.rejected`
- `email.unsubscribe.recorded`
- `email.personalization.unknown_token`
- `tenant.email_tracking.toggled`
- `tenant.sending_domain.added`
- `tenant.sending_domain.verified`
- `tenant.suspended.spam_risk`
- `campaign.template.updated`
- `campaign.launched`
- `campaign.test_sent`
- `campaign.preview.recipient_revealed`
- `webhook.endpoint.created`
- `webhook.endpoint.updated`
- `webhook.endpoint.deleted`
- `webhook.endpoint.auto_disabled`
- `webhook.endpoint.secret_rotated`
- `webhook.endpoint.pii_optin_enabled`
- `webhook.delivery.attempted`
- `webhook.delivery.failed`
- `webhook.delivery.dead_lettered`
- `webhook.dlq.replayed`

Retention guidance:
- All `webhook.endpoint.*` mutations + `campaign.launched` + `tenant.sending_domain.verified` + `tenant.email_tracking.toggled` → **7 years** (regulatory + GDPR evidence).
- `webhook.delivery.*` + `email.tracking.*` operational → **90 days** then aggregate-only.
- `*.rate_limited`, `*.rejected`, `email.click.rejected` → **30 days** (noise floor).

---

## Handoff

- **`backend-engineer`**: this document is your input. Implement TODO list top-down (H×H first). Every checkbox should map to either a code change or a test. The Outbox table (T-WH-T-05) is the structural prerequisite for the rest of the webhook hardening — do it first within the webhook subset.
- **`security-red-team`**: after backend-engineer implements, run adversarial review against the threat IDs above — try actual exploits (curl-replay open-pixel 1000×, register webhook URL with TTL=1s flipping IP, post `__proto__` in templateJson, register sending domain from `gmail.com`, send-test to arbitrary email, etc.).
- **`qa-automation`**: e2e scaffolds in `test/email-tracking.e2e.spec.ts`, `test/campaign-builder.e2e.spec.ts`, `test/webhooks.e2e.spec.ts` should include at least one test per H×H threat ID.
- **`security-blue-team`**: verify all new audit events flow to SIEM; verify RLS active on new `OutboxEvent`, `TenantSendingDomain`, `EmailUnsubscribe` tables; verify retention crons running.
- **`compliance`**: DPIA artifact for email tracking (`docs/dpia/email-tracking.md`); DPA addendum language for PII-via-webhook opt-in.

## STRIDE coverage scorecard

| Feature | S | T | R | I | D | E | Total |
|---|---|---|---|---|---|---|---|
| Email tracking | 3 | 3 | 2 | 4 | 3 | 2 | 17 |
| Campaign builder | 2 | 6 | 1 | 2 | 3 | 2 | 16 |
| Webhooks marketplace | 2 | 5 | 1 | 4 | 4 | 2 | 18 |
| **Total** | **7** | **14** | **4** | **10** | **10** | **6** | **51** |

All six STRIDE categories addressed for each feature. No category empty.
