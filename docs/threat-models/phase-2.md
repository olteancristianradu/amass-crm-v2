# Phase 2 — STRIDE Threat Model

> Generated 2026-05-17 by `security-architect` agent · review owner: Radu
> Scope: ROADMAP_V2.md §2 Phase 2 (Closing the deal) — E-sign on contracts (in-house), Approval workflows multi-step.
> Baseline (CLAUDE.md rule #3): JwtAuthGuard + RolesGuard + `TenantContextMiddleware` (ALS) → `runWithTenant()` on Prisma client with `tenantExtension()` → Postgres RLS via `SET LOCAL app.tenant_id` + `SET LOCAL ROLE app_user` → append-only audit log.
> Style anchored on [`docs/threat-models/phase-1.md`](./phase-1.md).

## Legend

- **Likelihood**: L (rare / requires insider or chained exploit), M (achievable by motivated tenant user), H (achievable by any authenticated user OR fully unauthenticated)
- **Impact**: L (annoyance / cosmetic), M (single-tenant data corruption, ops noise, fines per tenant), H (cross-tenant leak, money loss, regulatory breach, contract repudiation, reputational hit at brand scale)
- **Risk = Likelihood × Impact**; H×H prioritized
- **Confidence markers** (per CLAUDE.md): `[verificat]` = checked with tool now, `[presupun]` = inference, `[propus]` = does not yet exist, must be built

## Current state (as-built, before Phase 2 work)

- `Contract` model exists `[verificat: prisma/schema.prisma:2249]` with `status, signedAt, storageKey, createdById, autoRenew, value, currency, startDate, endDate, renewalDate`. **No `ContractSignature`, no `ContractTemplate`, no signature ceremony state, no audit hash, no signer identity, no PDF hash snapshot.** All `[propus]` for Phase 2.
- `ContractsService` exists with create/findAll/findOne/update flows `[verificat: contracts.service.ts:1-104]`. All paths through `runWithTenant`; status transitions not state-machine-enforced (any update can flip status).
- `ApprovalPolicy`, `ApprovalRequest`, `ApprovalDecision` models exist `[verificat: prisma/schema.prisma:1608,1630,1650]`. **Limited to single-trigger, single-approver, quote-only subject** (`quoteId: String @map("quote_id")` is required field — no polymorphic `subjectType`/`subjectId`). No ordering, no multi-step chain, no parallel approvers, no conditional logic, no delegation. All `[propus]` for Phase 2 extension.
- `ApprovalsService` exists `[verificat: approvals.service.ts:1-175]`. Decision flow gated by `approverId == userId` OR null (any manager). State machine: PENDING → APPROVED|REJECTED, no re-submit chain.
- `pdfkit ^0.15.2` is in `apps/api/package.json` `[verificat]`. Used today for invoice PDFs. **No `pdf-lib` or `puppeteer`** — pdfkit produces NEW PDFs from primitives, cannot re-flow an existing template PDF; this matters for template integrity (T-ESIGN-T-02).
- MinIO presigned PUT/GET pattern in use for attachments + invoices `[verificat: rule from CLAUDE.md §architecture mandates]`.
- No `ContractTemplate` model and no template marketplace today.
- eIDAS classification reminder: with drawn signature + audit hash, this is **Simple Electronic Signature (SES)**, NOT Advanced (AdES) and NOT Qualified (QES). SES is admissible in EU courts but burden of proof of signer intent + identity falls on us. **Lawyer review BLOCK before prod release** per ROADMAP_V2 §9 line 128 `[verificat]`.

---

## Feature 1 — E-sign on contracts (in-house)

### Trust boundaries

1. **Tenant user (drafter) → `POST /contracts/:id/signature-requests`** — picks signer email + role; authenticated session, tenant-scoped.
2. **Server → MinIO** — generates PDF from `Contract` template + variable substitution; uploads to MinIO; the PDF that ends up at this `storageKey` is the legally binding artifact.
3. **Server → SMTP relay → signer email** — sends ceremony link `https://app.amass-crm.com/sign/<ceremonyToken>`. The signer may be **external** (not a User row in any tenant); the email address is the only identity binding.
4. **Signer (untrusted, possibly anonymous browser) → `GET /sign/<ceremonyToken>`** — completely unauthenticated public endpoint; serves PDF preview + canvas. This is the highest-risk surface (replay, brute-force, scraping, parallel sessions).
5. **Signer → `POST /sign/<ceremonyToken>/submit`** — body: signature PNG (base64), drawn-at timestamp, "I agree" checkbox, optional typed full name. Server captures IP + UA from headers.
6. **Server → audit hash computation + persistence** — `sha256(pdfHash || signatureImageHash || timestamp || ipPrefix || uaFamily || ceremonyToken)`; persisted append-only.
7. **Server → SMTP → both parties** — confirmation email with signed PDF + audit summary; second highest-risk if confirmation contains the PDF inline (PDF size, email-as-PII).
8. **Tenant user (drafter) → `GET /contracts/:id/signature-audit`** — reads the audit trail; gated by tenant role.
9. **External regulator / court → audit export** — `[propus]` future export endpoint for dispute resolution; must be tamper-evident.

### Assets

| Asset | Type | Location |
|---|---|---|
| `ContractTemplate(tenantId, name, bodyMarkdown, variables Json, isActive)` | Postgres | `[propus]` |
| `ContractSignatureCeremony(id, tenantId, contractId, signerEmail, signerName, signerRole, ceremonyTokenHash, pdfStorageKey, pdfHash, status, sentAt, viewedAt, signedAt, expiresAt, withdrawnAt)` | Postgres | `[propus]` |
| `ContractSignature(id, tenantId, ceremonyId, signatureImageStorageKey, signatureImageHash, signerIpPrefix, signerUaFamily, signerTypedName, agreedAt, auditHash, auditHashPrev)` | Postgres | `[propus]` (append-only, no UPDATE allowed at Postgres RLS level) |
| Ceremony token (raw) | In email / URL only, hashed on storage (mirror Password reset pattern `[verificat: schema.prisma:120,189,209,1903]`) | not in DB |
| Signature PNG | MinIO bucket, server-side encrypted | `[propus]` |
| Final signed PDF | MinIO bucket, immutable after signing | `[propus]` |
| Hash chain (per-tenant Merkle log) | Postgres `ContractSignature.auditHashPrev` → prev row's `auditHash` | `[propus]` (tamper-evidence vs DB admin) |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-ESIGN-S-01 | Spoofing | **Signer impersonation via email interception** — drafter sends ceremony link to `ceo@victim.com`. Attacker on victim's mail path (compromised SMTP relay, BEC, mail-rule-forward, careless mail-list archive that exposes URL) opens the link and signs. From CRM's view: signed by "CEO" at the right email. Court: drafter says "this isn't my signature." `[verificat: ROADMAP_V2.md line 128 — lawyer-review BLOCK]`. | Ceremony URL | H | H | (1) **Two-factor ceremony**: email-link delivers signer to a page that asks for an OTP sent via independent channel — SMS (Twilio is in stack) OR voice. Phone collected from drafter at request creation, validated as E.164. (2) Optional: KBA (knowledge-based auth) — drafter pre-supplies a shared secret (last 4 of fiscal code, invoice ref) signer must enter. (3) Capture `signerEvidence Json` snapshot: OTP delivery receipt, OTP entry timestamp, channel = `sms\|voice`. This converts SES → "SES with reinforced evidence" closer to AdES per eIDAS Art. 26(b) "uniquely linked to signatory" — still NOT AdES (needs qualified cert) but materially stronger. (4) Audit: `contract.signature.otp_sent`, `contract.signature.otp_failed`, `contract.signature.otp_verified`. |
| T-ESIGN-S-02 | Spoofing | **Ceremony token brute force** — URL is `/sign/<token>`. If token is short or low-entropy, attacker enumerates address space, finds unsigned ceremonies, signs as the legitimate signer's email. | `ceremonyTokenHash` | M | H | (1) Token = 32 raw bytes from `crypto.randomBytes(32)` → base64url → 43 chars, ~256 bits. Birthday-collision infeasible. (2) Store **only `sha256(token)`** in DB (`ceremonyTokenHash`), mirroring the password-reset pattern `[verificat: schema.prisma:120 PasswordReset.tokenHash, 189 InviteToken.tokenHash, 209 EmailVerification.tokenHash, 1903 ApiKey.tokenHash]`. DB dump alone cannot sign. (3) Lookup by tokenHash with constant-time compare (Prisma `findUnique` on `tokenHash` is OK because miss is a query-shape match, not a string-compare timing leak). (4) Rate-limit `/sign/<token>` to 10 attempts/min/IP and 100/day/IP — well below brute-force throughput against 256-bit space; mostly stops accidental enumeration by web scanners. (5) `expiresAt` default 14 days; cron purges expired ceremonies; cannot indefinitely enumerate. |
| T-ESIGN-S-03 | Spoofing | **From-address spoofing on signer email** — confirmation/invitation email shows `From: docs@<tenant-slug>.amass-crm.com`. If a tenant subdomain becomes look-alike (`microsofft` typosquat), the invitation email itself becomes phishing-ready bait. | Outbound `From` header | M | M | Reuse Phase 1 T-CB-S-01 control: `TenantSendingDomain` verification mandatory; unverified tenants forced to `noreply@<slug>.send.amass-crm.com` (slug is unique, validated against typosquat blacklist of top-1000 brands at creation). Phase 1 deliverable — Phase 2 depends on it. |
| T-ESIGN-T-01 | Tampering | **PDF substitution between generate and signer view** — server generates PDF at `storageKey=K`, uploads to MinIO; before signer GET, MinIO bucket policy permits a tenant admin (or a leaked MinIO root cred) to overwrite the object at `K`. Signer signs PDF v2; drafter holds PDF v1; dispute. | MinIO object | M | H | (1) MinIO **object lock** (WORM, governance mode) on the signed-contracts bucket — once an object is uploaded with a `retentionUntil`, even tenant admin cannot overwrite or delete. (2) `pdfHash = sha256(pdfBytes)` computed at generation, persisted in `ContractSignatureCeremony.pdfHash`; on every signer GET, **re-fetch from MinIO, re-hash, assert match** before serving. Mismatch → 410 Gone + `contract.signature.pdf_hash_mismatch` audit event + alert. (3) Final signed PDF stored at a **different** key (`signed/<ceremonyId>.pdf`) than the pre-sign preview to avoid race with overwrite. |
| T-ESIGN-T-02 | Tampering | **Template variable injection** — drafter's template contains `{{contact.fiscalCode}}`; pdfkit (or whatever renderer) does string substitution; attacker drafter puts `{{user.passwordHash}}` (same class as Phase 1 T-CB-T-02). PDF leaks secret to external signer. | Template renderer | M | H | Reuse Phase 1 T-CB-T-02 allow-list pattern: scoped object built before render, allow-list per token namespace (`contact.{firstName,lastName,fiscalCode,address}`, `company.{name,address,vatId}`, `contract.{title,value,currency,startDate,endDate}`, `tenant.{name,brandName,legalAddress}`); anything outside list renders empty + `contract.template.unknown_token` audit. Pre-built typed object means even allow-list bug cannot reach `passwordHash`. |
| T-ESIGN-T-03 | Tampering | **Signature image as XSS / SSRF vector** — submitted "signature" is PNG base64; attacker submits a crafted SVG (renamed to .png) or a polyglot file. Confirmation email/HTML preview renders it → XSS in drafter's email client; PDF embed renders the SVG with embedded scripts → script execution in Apple Mail (some clients). | Signature image | M | M | (1) MIME allow-list `image/png` only; magic-byte check (`89 50 4E 47 0D 0A 1A 0A`) — reject if mismatch. (2) Re-encode via `sharp` (server-side, deterministic): decode → resample to 600×200 max → re-encode PNG with all metadata stripped. The re-encoded image, not the upload, goes to MinIO + PDF + email. (3) Max signature size 200 KB before re-encode (T-ESIGN-D-02). (4) Email render: signature inserted as `<img>` tag pointing to a presigned MinIO GET URL — never inline base64 (avoids polyglot delivery), CSP `img-src 'self' https://*.amass-crm.com`. |
| T-ESIGN-T-04 | Tampering | **Audit hash forgery** — DB admin (or attacker with DB write) inserts a `ContractSignature` row with arbitrary fields + matching `auditHash = sha256(...)` computed from those same fields. No external anchor → tampering is detectable only if we have an out-of-band record. | Audit chain | L | H | (1) **Hash chain**: `ContractSignature.auditHashPrev` points to the previous row's `auditHash` for the same `tenantId` (per-tenant chain). Single forgery breaks chain forward for all subsequent rows. (2) Daily cron computes `sha256(chain_head)` per tenant and POSTs it to an **external Trusted Timestamp Authority** (RFC 3161 TSA — free options: `freetsa.org`, paid: DigiCert, GlobalSign). Store TSR (Time-Stamp Response) tokens. Court-grade evidence the chain existed at time T with that head. (3) Cron `contract.audit.timestamped {tenantId, chainHead, tsaToken}` audit event. (4) `[propus] [block-merge]`: documented in dispute-resolution playbook so customer support knows how to extract proof. |
| T-ESIGN-T-05 | Tampering | **Race condition on multi-party signing** — contract with 2 signers; both ceremonies open in parallel; signer 2 signs the PDF that signer 1 hasn't yet signed → final document order ambiguous. Or: signer 1 signs, drafter modifies template, regenerates PDF for signer 2 → 2 different documents signed. | Multi-party flow | M | H | (1) `ContractSignatureCeremony.signOrder Int` — strictly ordered; signer N's ceremony is created only after signer N-1 submits. Until then `status = PENDING_PREDECESSOR`. (2) Drafter cannot modify the contract once **any** ceremony is in `SENT` or `SIGNED` state — `Contract.update` rejects with `409 CONTRACT_LOCKED_FOR_SIGNING` if any ceremony exists in non-terminal state. (3) "Parallel signing" mode (optional Phase 3 — defer): all signers sign the SAME PDF (same `pdfHash`), each `ContractSignature` row chains to a common ceremony bundle; no edit allowed between first and last signature. |
| T-ESIGN-R-01 | Repudiation | **Signer claims "I never signed"** — without evidence of intent + identity + integrity, we lose in court. SES is admissible per eIDAS Art. 25 but burden of proof is on the relying party. | Audit trail | H | H | (1) Capture FULL evidence bundle per `ContractSignature`: `{ipPrefix: '/24' or '/48', uaFamily, uaFull[hashed for forensics], geoCountry[via IP lookup], otpDeliveredAt, otpVerifiedAt, otpChannel, viewedAt, scrollDepthReachedEnd: boolean (signer must scroll PDF to bottom), clickedAgreeAt, drawingDurationMs (anti-bot), drawingStrokeCount, agreedTextCheckbox: boolean, typedFullNameMatchesEmail: boolean}` → all in `signerEvidence Json`. (2) Display "by drawing your signature you agree to be legally bound" copy ABOVE the canvas with checkbox below. Copy in same language as the signer's email (default RO/EN). (3) Email confirmation to BOTH parties immediately with PDF + audit summary; signer's claim of "never received" undermined by SMTP delivery receipt. (4) Hash chain + TSA token (T-ESIGN-T-04) for integrity. (5) `[block-merge]`: lawyer reviews evidence-bundle schema BEFORE prod release. |
| T-ESIGN-R-02 | Repudiation | **Drafter claims "I never sent this contract"** — same problem in reverse. Drafter compromised account sent it; legitimate drafter denies. | Audit | M | M | `contract.signature.request_created {contractId, ceremonyId, signerEmail, drafterId, drafterIp, drafterSession}` audit event with 7y retention (matches contracts retention). MFA on drafter session (existing) means single-factor compromise insufficient. |
| T-ESIGN-R-03 | Repudiation | **Withdrawal of signature** — signer signs, then 5 minutes later claims duress and demands withdrawal. GDPR Art. 7(3) gives right to withdraw consent for processing; eIDAS does NOT give automatic right to withdraw a signed contract (the contract is a legal act, not a consent to process data). These two interact. | Withdrawal flow | M | M | (1) Distinguish: "withdraw signature" = NOT supported post-signing (contract is binding). "Cancel ceremony" = before signing, drafter or signer can cancel → status `CANCELLED`; no `ContractSignature` row created; `contract.signature.cancelled` audit. (2) Post-signing dispute = legal process, not a button. Document this distinction explicitly in the signer-facing copy ("by signing, you create a legally binding obligation; you cannot cancel after submission"). (3) Data-deletion under GDPR Art. 17 vs contract evidence: signature audit cannot be deleted (Art. 17(3)(e) — legal claims defense). Document in DPA. |
| T-ESIGN-I-01 | Information disclosure | **Ceremony URL leak via email forwarding** — signer forwards invitation to assistant "please sign this for me"; assistant signs. CRM cannot tell, but contract may be void (no signer intent of named party). | Ceremony URL | H | M | (1) OTP to original signer's phone number (T-ESIGN-S-01) means forwarding the URL alone is insufficient. (2) Document for drafters: "if you suspect the signer forwarded the link, cancel the ceremony and re-issue to a verified channel." (3) Audit `contract.signature.ceremony_viewed {ip, ua, viewedAt}` — multiple views from disparate geos = red flag, expose in drafter UI. |
| T-ESIGN-I-02 | Information disclosure | **PDF preview leaks to scrapers** — `/sign/<token>` returns the full PDF including pricing, fiscal codes, personal data. Search engines / scrapers / threat-intel feeds may follow URLs they find in email archives. | Public URL | M | H | (1) `X-Robots-Tag: noindex, nofollow, noarchive` + `<meta name="robots" content="noindex">` on the sign page. (2) PDF served via short-TTL (5 min) presigned MinIO URL minted per page-load, not a stable URL. (3) **Capability check before serving PDF**: ceremony must have been "claimed" first (signer clicks "Yes I'm <name>" → server sets `ceremony.claimedAt`); only post-claim does PDF GET work. Reduces drive-by scraper exposure. (4) `Cache-Control: private, no-store` on all sign pages. |
| T-ESIGN-I-03 | Information disclosure | **Cross-tenant ceremony token reuse** — attacker tenant-A registers signer email = `victim@tenant-b.com`; sends ceremony for a malicious contract → if there's no tenantId binding on the token side, social-engineers victim into signing tenant-A's contract. (No cross-tenant data leak per se, but reputational + legal attack on victim using our infra.) | Inbound ceremony | M | M | (1) Email content includes the **drafter's verified company name** prominently ("You have received a contract from <Tenant.brandName>") in a way that the signer cannot mistake. (2) `From` address bound to verified `TenantSendingDomain` (T-ESIGN-S-03). (3) Optional: tenant brand whitelist per signer email (signer pre-approves which tenants can send them contracts — heavy, defer to Phase 3). (4) Abuse-report endpoint `/sign/<token>/report-abuse` triggers `tenant.abuse.signature_phishing_reported` audit + auto-pause sending after N reports. |
| T-ESIGN-I-04 | Information disclosure | **GDPR Art. 6 lawful basis for IP/UA storage** — we capture signer IP + UA permanently for repudiation defense. Without articulated legal basis, this is a fine. | `signerEvidence` | M | M | Lawful basis = **legitimate interest** (Art. 6(1)(f)) for contract evidence defense; balancing test in DPIA. (1) Store **IP prefix only** by default (/24 IPv4, /48 IPv6) — full IP hashed with per-tenant pepper for forensic-only access (key escrow). (2) Privacy notice on sign page before submission: "we will retain your IP, browser, and signature for the legal lifetime of this contract as proof; click Agree to proceed." (3) DPIA artifact `docs/dpia/e-sign.md` `[propus]`. (4) Retention = 10 years (Romanian Civil Code statute of limitations for general obligations) — documented in retention schedule. |
| T-ESIGN-D-01 | Denial of service | **Mass-spam ceremony creation** — compromised tenant member creates 10k ceremonies to random emails to weaponize CRM as a spammer. | SMTP relay | H | H | (1) Per-tenant cap: 100 ceremonies/day for free/trial, 1000/day for basic, 10000/day for pro (per Phase 1 T-CB-D-01 quota pattern). (2) Per-user cap: 50 ceremonies/day (drafters). (3) Per-(tenant, signer email) cap: 5/day — prevents spamming the same victim. (4) Spam-classifier on contract title + body + signer-name fields. (5) `contract.signature.rate_limited` audit event. |
| T-ESIGN-D-02 | Denial of service | **Signature PNG size attack** — signer submits 100 MB PNG; pre-encode buffer eats memory; sharp re-encode CPU. | API memory | M | M | (1) Multipart body size cap 1 MB at Caddy edge for `/sign/*` POSTs. (2) Reject upload if base64 string >1.3M chars (1 MB binary ≈ 1.33 MB base64). (3) Sharp re-encode timeout 5s, max resolution 4096×4096 before resize. (4) `contract.signature.payload_oversized` audit. |
| T-ESIGN-D-03 | Denial of service | **PDF generation amplification** — pdfkit + variable substitution × 10k templates with N pages each → CPU pegged. | API CPU | M | M | (1) PDF generation in a dedicated BullMQ queue (`contract-pdf-render`) with concurrency cap 4/tenant, 30s timeout. (2) Template page-count cap (10 pages default, 50 hard cap). (3) `contract.template.render_timeout` audit. |
| T-ESIGN-E-01 | Elevation of privilege | **Drafter signs as signer (self-deal)** — drafter creates contract, registers ceremony with their own email, signs as both parties → looks like the customer agreed. | Conflict-of-interest | M | H | (1) **Signer email MUST differ from drafter's email** (Zod check + service-level guard). (2) Signer email MUST differ from any User in the same tenant (so an internal accomplice cannot sign as "customer"). (3) Bypass requires explicit `OWNER`-role override with reason logged: `contract.signature.internal_signer_override {reason}` audit. (4) `[propus]` Per-tenant config: "external-only signers" boolean enforced. |
| T-ESIGN-E-02 | Elevation of privilege | **Status transition bypass** — `ContractsService.update()` today accepts arbitrary status flips `[verificat: contracts.service.ts:75-104]` because there's no state-machine guard. Drafter could flip `DRAFT → ACTIVE` without signing. | `Contract.status` | M | M | (1) State machine in service layer: `DRAFT → SENT_FOR_SIGNING → PARTIALLY_SIGNED → FULLY_SIGNED → ACTIVE → EXPIRED|TERMINATED|RENEWED`. (2) Transition to `ACTIVE` only via the signature-completion callback, NEVER via PATCH /contracts/:id. (3) Add `Contract.status` enum members for the new states; migration. (4) Update controller PATCH to reject `status` in body (allowed only via dedicated transition endpoints, each role-gated). |
| T-ESIGN-E-03 | Elevation of privilege | **Cross-tenant contract leak via ceremony token** — ceremony for tenant-A's contract; the public `/sign/<token>` handler uses `prisma.findUnique({where: {tokenHash}})` bypassing tenant filter; THEN extracts `tenantId` from the ceremony row and calls `runWithTenant`. Same pattern as Phase 1 T-MAIL-E-01. Correct, but fragile. | Cross-tenant ceremony | L | H | (1) Same comment-as-invariant pattern: "ceremonyTokenHash is the source of tenantId for /sign endpoints — never accept tenantId from query/body". (2) Integration test: post-signing for tenant-A's ceremony from a session bound to tenant-B does not pollute tenant-B's audit. (3) The public `/sign/*` controller is in a SEPARATE module with no auth guards, similar to `/e/t/*` (email tracking) — keeps the bypass narrowly scoped. |

### Controls to implement (E-sign)

- [ ] `ContractTemplate` model + `bodyMarkdown` + scoped variable allow-list.
- [ ] `ContractSignatureCeremony` model + `ceremonyTokenHash` (sha256 of 32-byte random) + `pdfHash` + `pdfStorageKey` + `expiresAt` (14d default) + `signOrder` + status enum (`PENDING_PREDECESSOR, DRAFT, SENT, CLAIMED, SIGNED, EXPIRED, CANCELLED`).
- [ ] `ContractSignature` model + `signatureImageStorageKey` + `signatureImageHash` + `signerIpPrefix` + `signerUaFamily` + `signerEvidence Json` + `auditHash` + `auditHashPrev` (per-tenant hash chain).
- [ ] Postgres RLS policy on `contract_signatures`: only INSERT permitted via app_user role; no UPDATE, no DELETE (append-only at DB level).
- [ ] MinIO object lock (WORM, governance) on `signed-contracts` bucket.
- [ ] PDF hash verify on every signer GET; 410 Gone + alert on mismatch.
- [ ] PNG-only signature upload + magic-byte check + sharp re-encode (600×200 max, metadata stripped, 200KB cap).
- [ ] OTP (SMS via Twilio) as second factor before signature submission; capture in `signerEvidence`.
- [ ] Drafter-supplied signer phone number (E.164) at ceremony creation; required for OTP.
- [ ] Daily cron: per-tenant audit chain head → external RFC 3161 TSA → store TSR token; `contract.audit.timestamped` audit event.
- [ ] State machine in `ContractsService`: status transitions ONLY via dedicated endpoints; PATCH /contracts/:id rejects `status` in body.
- [ ] Signer email MUST ≠ drafter email; signer email MUST ≠ any User in same tenant (override requires OWNER + reason).
- [ ] Multi-party: strict order; `Contract.update` locked once any ceremony is `SENT|CLAIMED|SIGNED`.
- [ ] Per-tenant + per-user + per-(tenant, signer) ceremony quotas.
- [ ] PDF render in BullMQ queue (`contract-pdf-render`), concurrency 4/tenant, 30s timeout.
- [ ] Reuse `TenantSendingDomain` (Phase 1 dependency) for ceremony invitation `From`.
- [ ] Sign page: `X-Robots-Tag: noindex, nofollow, noarchive`; `Cache-Control: private, no-store`; CSP `default-src 'self'; img-src 'self' https://*.amass-crm.com; script-src 'self'` (no inline).
- [ ] Privacy notice + "legally bound" copy + checkbox + scroll-to-bottom requirement.
- [ ] Drafter-visible "multiple views from different geos" red-flag indicator.
- [ ] Abuse-report endpoint `/sign/<token>/report-abuse` + auto-pause tenant after N reports.
- [ ] DPIA artifact `docs/dpia/e-sign.md`.
- [ ] Dispute-resolution playbook `docs/playbooks/contract-dispute.md`.
- [ ] **BLOCK-MERGE**: lawyer review of evidence-bundle schema + signer-facing copy + retention schedule.
- [ ] Audit events: `contract.template.created`, `contract.template.unknown_token`, `contract.signature.request_created`, `contract.signature.otp_sent`, `contract.signature.otp_failed`, `contract.signature.otp_verified`, `contract.signature.ceremony_viewed`, `contract.signature.pdf_hash_mismatch`, `contract.signature.payload_oversized`, `contract.signature.rate_limited`, `contract.signature.submitted`, `contract.signature.cancelled`, `contract.signature.internal_signer_override`, `contract.template.render_timeout`, `contract.audit.timestamped`, `tenant.abuse.signature_phishing_reported`.

---

## Feature 2 — Approval workflows multi-step

### Trust boundaries

1. **Tenant admin → `POST /approval-policies` / `PATCH`** — defines policy (trigger conditions + ordered approver chain). Privilege check at controller (only OWNER/ADMIN).
2. **Subject mutator (e.g., quote sender, deal-stage-advancer, invoice-issuer) → `ApprovalsService.maybeRequireApproval()`** — internal call from peer services; the SUBJECT module decides when to invoke. If they skip, approval is bypassed.
3. **Approver (User of tenant) → `POST /approval-requests/:id/decisions`** — approve or reject; authenticated session.
4. **Notification → approver email / in-app** — sends "you have a pending approval" with deep link.
5. **State machine → next approver** — on APPROVE, advance to next step; on REJECT, terminate.
6. **Workflow definition mutator** — what happens to in-flight requests when the policy changes?

### Assets

| Asset | Type | Location |
|---|---|---|
| `ApprovalPolicy(tenantId, name, trigger, config, approverId, isActive)` (single approver, single subject) | Postgres | `prisma/schema.prisma:1608` `[verificat]` — needs extension |
| `ApprovalPolicyStep(policyId, stepOrder, approverId\|approverRole, condition Json, isParallel)` | Postgres | `[propus]` — multi-step support |
| `ApprovalRequest(tenantId, policyId, subjectType, subjectId, requestedBy, status, currentStepOrder)` | Postgres | `prisma/schema.prisma:1630` `[verificat]` — `quoteId` field MUST be replaced with polymorphic `subjectType` + `subjectId` |
| `ApprovalDecision(tenantId, requestId, stepOrder, deciderId, status, comment, decidedAt)` | Postgres | `prisma/schema.prisma:1650` `[verificat]` — append-only; needs `stepOrder` column |
| `ApprovalNotification(approverId, requestId, sentAt, channel)` | Postgres | `[propus]` |
| In-flight request workflow snapshot (immutable) | `ApprovalRequest.policySnapshot Json` | `[propus]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-APPR-S-01 | Spoofing | **Notification spoofing** — attacker sends forged email "you have an approval pending: <click here>" to approver, link goes to phishing clone. Approver clicks "approve" thinking it's our app. | Approver email | M | H | (1) All approval emails sent from verified `TenantSendingDomain` only (Phase 1 dependency T-CB-S-01). (2) Email includes the **policy name + requesting user's name + amount** in the visible body; phishing replicas would need to know this context. (3) **NEVER include direct one-click approval URL in email** — link goes to the app's login page, approver must authenticate before seeing the request. No "magic link approve" — too high-risk. (4) Optional in-app push (Phase 1 sync gateway) as primary channel; email as fallback. |
| T-APPR-S-02 | Spoofing | **Approver session hijack → batch approve** — attacker steals session cookie (XSS, CSRF), approves all pending requests for that user. | Session | L | H | (1) MFA enforced for OWNER/ADMIN roles already; extend to approver action: any decision endpoint requires re-confirmation (re-enter password OR fresh OTP) if session is older than 5 min OR if decision affects subject with `value > tenantConfig.approvalReauthThreshold`. (2) `approval.decision.reauth_required` audit event. (3) Standard CSRF token on `POST /approval-requests/:id/decisions` (existing global protection). |
| T-APPR-T-01 | Tampering | **Approval order tampering at request creation** — requester crafts request body with approver chain that lists themselves first. | Request payload | H | H | (1) **Requester does NOT supply the approver chain — it is derived from `ApprovalPolicy` at request-creation time and frozen as `ApprovalRequest.policySnapshot Json`**. Requester only supplies subject ID + optional reason. (2) Server resolves matching active policies (multiple policies may match — first match by `priority Int` field, ties broken by `createdAt`); snapshots the full step chain into the request. (3) Zod schema rejects extra fields on request payload. |
| T-APPR-T-02 | Tampering | **Workflow definition mutation mid-flight** — admin edits policy after request is created but before final approval. New steps applied to in-flight request → either bypass remaining steps or inject hostile approver. | Policy update | M | H | (1) `ApprovalRequest.policySnapshot` is the immutable plan — in-flight requests use the snapshot, NOT the live policy. Policy updates affect only NEW requests. (2) `ApprovalPolicy.version Int` incremented on every update; snapshot stores `(policyId, version)`. (3) Deletion of policy with in-flight requests: soft-delete only (`isActive=false`), keep row for snapshot integrity; `approval.policy.deleted_with_inflight` audit event. |
| T-APPR-T-03 | Tampering | **State machine bypass via direct decision endpoint** — attacker discovers that `POST /approval-requests/:id/decisions` accepts a decision even when the request is in a non-PENDING state, or when the caller is not the current step's approver. Status flips to APPROVED, audit shows correct decider for OTHER step. | Decision endpoint | M | H | (1) Decision endpoint guard: `request.status == PENDING && currentStep.approverId == userId && !alreadyDecidedThisStep(userId, currentStepOrder)`. (2) State transitions use `UPDATE ... WHERE status='PENDING' AND currentStepOrder = $expected` — optimistic concurrency; if WHERE matches 0 rows, return `409 STALE_REQUEST` (lost race or double-submit). (3) Append-only `ApprovalDecision` table; UPDATE/DELETE blocked at RLS. |
| T-APPR-T-04 | Tampering | **Conditional-approval bypass via split** — policy "amount > 10k requires VP." User submits 2 requests of 5k each instead. | Splitting | H | H | (1) Document this as accepted at the workflow level — splitting is a business-process problem, not a technical one. (2) Detection rule (BI / report layer): same requester + same subject company + same week + sum > threshold → flag for manual review (`approval.split_pattern_detected` audit). (3) Optional Phase 3: aggregate-rule trigger `SUM(amount) WHERE companyId = X AND createdAt > now - 7d` evaluated at request time — heavy, defer. |
| T-APPR-T-05 | Tampering | **Cycle / re-submit loop** — requester submits, gets rejected, modifies, re-submits, gets rejected, re-submits N times → approver fatigue + DB bloat. | Request lifecycle | M | M | (1) Per-(requester, subjectType, subjectId) cap: max 3 active or recently-rejected requests in 24h. (2) Rejected request CANNOT be "reopened" — requester must create a NEW request that links to the rejected one (`previousRequestId` for trace). Approver sees the history. (3) `approval.request.resubmit_capped` audit event. |
| T-APPR-T-06 | Tampering | **Prototype pollution via policy.config** — `ApprovalPolicy.config Json` is currently `@default("{}")` and stored as Prisma `InputJsonValue` `[verificat: approvals.service.ts:25]`. If business logic later does `lodash.merge(defaults, policy.config)` to evaluate triggers, `{"__proto__":{"admin":true}}` propagates. | Trigger evaluator | M | H | Same defense as Phase 1 T-CB-T-03: Zod schema per trigger type strict-validates `config` shape (e.g., `QUOTE_ABOVE_VALUE = z.strictObject({threshold, currency})`); reject `__proto__`/`prototype`/`constructor` keys; ban `lodash.merge`/`defaultsDeep` in `apps/api/src/modules/approvals/`. |
| T-APPR-R-01 | Repudiation | **Approver claims "I never approved that"** — clicks happen fast on mobile, real or denied. Without good evidence: log of session, IP, UA, exact button. | Decision audit | M | M | `approval.decision.recorded {requestId, stepOrder, deciderId, decision, decisionIp, decisionUa, sessionId, reauthMethod, decidedAt}` audit + 7y retention (regulatory + dispute defense). Comment field optional but encouraged via UX. |
| T-APPR-R-02 | Repudiation | **Requester edits subject after submission** — user submits a $10k quote for approval, approver approves, requester edits quote to $50k before sending. | Subject mutation | M | H | (1) On approval-request creation, snapshot the relevant subject fields into `ApprovalRequest.subjectSnapshot Json` (e.g., for QUOTE: amount, currency, lines, customerId). (2) Subject mutator services check `await approvalsService.hasPendingRequest(subjectType, subjectId)` and refuse mutation if true (lock for the duration). (3) On APPROVED, snapshot is the authoritative version; subject may be mutated AFTER approval but a new approval is required if the new values would re-trigger any policy. (4) `approval.subject.locked_for_mutation`, `approval.subject.mutation_after_approval_triggered_re_review` audit events. |
| T-APPR-I-01 | Information disclosure | **Approver sees subject they shouldn't** — VP approves cross-department invoices; the request notification reveals customer name + amount to VP who normally has no access to that department's data. | Subject preview in UI | M | M | (1) Approver's `Roles` are evaluated AT THE TIME OF NOTIFICATION; if approver does not have read access to the subject (e.g., territory restriction, department restriction), the notification is sent to the next eligible approver in the chain (skip-rule). (2) Alternative: notification shows only minimum (subject ID, requester, amount range) and the deep link triggers full RBAC check when opened; if denied, approver cannot complete the workflow → fail-closed with `approval.approver.access_denied` audit + escalation to OWNER. (3) `approval.notification.skipped_approver_no_access` audit event. |
| T-APPR-I-02 | Information disclosure | **Comment field stores PII forever** — approvers comment "Customer's son-in-law, treat carefully" → personal data attached to the approval decision with 7y retention. GDPR Art. 5(1)(e) storage limitation. | `ApprovalDecision.comment` | L | M | (1) Privacy hint in UI placeholder: "do not include personal information in comments." (2) Per-tenant config: comment retention period (default 7y, configurable down to 2y minimum for businesses with policy-driven shorter retention). (3) DSAR (GDPR Art. 15) export must include any comments referencing the data subject — implement via Postgres full-text search over `ApprovalDecision.comment` at export time. |
| T-APPR-I-03 | Information disclosure | **Cross-tenant approval listing** — `listPolicies` or `listRequests` returns rows from other tenants if `runWithTenant` is skipped (regression risk in future refactor). | Listing endpoints | L | H | Already correctly wrapped in `runWithTenant` per `[verificat: approvals.service.ts]`. Regression defense: integration test asserts tenant-B session cannot see tenant-A's policies/requests/decisions across all approval endpoints. RLS already enforces at DB level. |
| T-APPR-D-01 | Denial of service | **Notification storm** — buggy or malicious policy with 50 approvers in chain × 1000 requests → 50k emails. | SMTP relay | M | M | (1) Cap policy step count: max 10 steps. (2) Cap parallel approvers per step: max 5. (3) Per-tenant notification quota: 1000 approval notifications/day for free, scale by plan. (4) Email notifications deduplicated per (approverId, day) — daily digest if >5 pending. |
| T-APPR-D-02 | Denial of service | **Database growth from request spam** — requester creates 10k requests/hour with valid policy matches. | `approval_requests` table | M | M | (1) Per-requester quota: 50 requests/hour, 200/day. (2) Per-(requester, subjectType, subjectId) cap from T-APPR-T-05. (3) `approval.request.rate_limited` audit. |
| T-APPR-E-01 | Elevation of privilege | **Self-approval** — requester == approver in chain. User submits a deal-discount request and they happen to also be the configured approver → approves themselves. | Approver resolution | H | H | (1) **Hard constraint at policy evaluation**: if resolved approver for step N == `request.requestedBy`, skip to step N+1 with `approval.step.skipped_self_approval` audit; if all steps end up skipped, escalate to OWNER. (2) UI warning at policy creation if any step's approver could overlap with common requester roles. (3) Hard constraint at decision endpoint: `userId != request.requestedBy` even if somehow assigned. |
| T-APPR-E-02 | Elevation of privilege | **Delegation chain abuse** — VP delegates to assistant; assistant delegates to intern; effective approver is intern. (Phase 2 MVP: defer delegation entirely OR limit to single-hop.) | Delegation | L | H | (1) MVP Phase 2: **no delegation**. Document explicitly. (2) Phase 3 if added: max 1 hop delegation; delegate cannot re-delegate; delegate must have minimum role-level >= configured floor for that policy (`minDelegateRole`); each delegated decision dual-audited (`delegatorId` + `deciderId`). |
| T-APPR-E-03 | Elevation of privilege | **Policy creation by non-OWNER** — controller allows MANAGER to create policies → MANAGER creates a "no approval needed" policy that overrides existing real policies. | `POST /approval-policies` | M | H | (1) Gate policy create/update/delete to `OWNER, ADMIN` only. (2) Policy resolution: if multiple policies match, prefer the most restrictive (longest chain, highest priority); a "no-op" policy never overrides a stricter active one. (3) Audit `approval.policy.created` + `approval.policy.updated` + `approval.policy.deleted` with 7y retention. |
| T-APPR-E-04 | Elevation of privilege | **Re-approval after subject mutation skipped** — T-APPR-R-02 mitigation requires that subject mutation after approval re-triggers review; if the mutator service forgets to call `approvalsService.maybeRequireApproval()`, the new value is APPROVED without review. | Subject mutator integration | M | H | (1) Centralize the trigger evaluation in `ApprovalsService.maybeRequireApproval(subjectType, subjectId, newValues)` — called from EVERY subject mutator. (2) Coverage test: for each `ApprovalPolicyTrigger` enum value, verify there is at least one subject mutator integration point that calls the function. (3) Document the integration contract in `docs/approvals-integration.md`. |

### Controls to implement (Approval workflows)

- [ ] `ApprovalPolicyStep` model + `stepOrder` + `approverId|approverRole` + `condition Json (Zod strict)` + `isParallel Boolean`.
- [ ] `ApprovalPolicy.version Int` + `ApprovalPolicy.priority Int`; soft-delete preserved for snapshot integrity.
- [ ] `ApprovalRequest`: replace `quoteId` with polymorphic `subjectType` enum + `subjectId String`; add `currentStepOrder Int`, `policySnapshot Json`, `subjectSnapshot Json`, `previousRequestId String?` (for resubmit trace).
- [ ] `ApprovalDecision`: add `stepOrder Int`, `decisionIp String`, `decisionUa String`, `sessionId String`, `reauthMethod String?`.
- [ ] Postgres RLS policy on `approval_decisions`: INSERT only via app_user; no UPDATE, no DELETE.
- [ ] Per-trigger Zod schema in `packages/shared/src/approval-triggers.ts`; reject `__proto__`/`prototype`/`constructor`; ban `lodash.merge` in `approvals/`.
- [ ] State machine: decision endpoint UPDATE uses `WHERE status='PENDING' AND currentStepOrder = $expected` (optimistic concurrency).
- [ ] Self-approval skip rule + all-skipped escalation to OWNER.
- [ ] No delegation in Phase 2 MVP (documented explicitly).
- [ ] Approver RBAC check at notification time + at link-open time; fail-closed to next approver / escalation.
- [ ] Notification dedup per (approverId, day); daily digest >5 pending.
- [ ] Re-auth required on decision if session >5min OR subject value > config threshold.
- [ ] Policy create/update/delete gated to `OWNER, ADMIN`.
- [ ] Centralized `maybeRequireApproval(subjectType, subjectId, newValues)` called from every subject mutator; coverage test enforces.
- [ ] Per-policy step count cap 10; per-step parallel approver cap 5.
- [ ] Per-requester quota: 50/hour, 200/day; per-(requester, subjectType, subjectId): 3/24h.
- [ ] Subject lock for mutation while approval pending.
- [ ] Subject snapshot on request creation; re-trigger review on mutation after approval if new values match policy.
- [ ] Comment field privacy hint + per-tenant retention config.
- [ ] DSAR export includes approval-comment search.
- [ ] Split-pattern detector (`approval.split_pattern_detected`) as a BI rule, not enforcement.
- [ ] Integration test: tenant-B cannot see tenant-A's policies/requests/decisions.
- [ ] Audit events: `approval.policy.created`, `approval.policy.updated`, `approval.policy.deleted`, `approval.policy.deleted_with_inflight`, `approval.request.created`, `approval.request.rate_limited`, `approval.request.resubmit_capped`, `approval.decision.recorded`, `approval.decision.reauth_required`, `approval.step.skipped_self_approval`, `approval.notification.sent`, `approval.notification.skipped_approver_no_access`, `approval.approver.access_denied`, `approval.split_pattern_detected`, `approval.subject.locked_for_mutation`, `approval.subject.mutation_after_approval_triggered_re_review`.

---

## Cross-feature residual risks

| ID | Risk | Why we accept it (Phase 2) |
|---|---|---|
| R-XF-P2-01 | SES (Simple Electronic Signature) vs AdES (Advanced Electronic Signature) vs QES (Qualified Electronic Signature) — our implementation is SES + reinforced evidence; for high-value contracts (>€100k, certain regulated sectors), customers may need QES via a Qualified Trust Service Provider (QTSP). | Documented in tenant-facing docs: "for QES-grade contracts, integrate a QTSP via the webhooks API; Phase 3 may add DocuSign/Adobe Sign integration." MVP serves the 95% case. |
| R-XF-P2-02 | Splitting attack on conditional approvals (T-APPR-T-04) is a process problem, not technical. | Detection rule + BI flag; full prevention requires aggregate-rule evaluation which is heavy. Defer to Phase 3. |
| R-XF-P2-03 | Signer forwarding ceremony URL to assistant + assistant signs (T-ESIGN-I-01); OTP to phone limits damage but does not eliminate. | Industry-standard limitation of SES; AdES/QES require certified identity (cert on smartcard) which is out of scope. |
| R-XF-P2-04 | Apple Mail Privacy Protection / Gmail proxy may interact poorly with confirmation emails containing large signed PDFs (pre-fetch consumes presigned URL window). | Use short presigned TTL (5 min) for signer view; confirmation email contains PDF as direct attachment, not link, to avoid pre-fetch issue. |
| R-XF-P2-05 | Hash chain anchor at RFC 3161 TSA depends on TSA availability; if TSA is down for days, chain head is unanchored for that period. | Multi-TSA fallback (freetsa.org primary, paid TSA secondary); local-only chain still proves intra-tenant integrity. Anchoring at next TSA-available cron run. |

---

## eIDAS compliance notes

| Level | Requirement | Phase 2 status |
|---|---|---|
| **SES** (Simple Electronic Signature, eIDAS Art. 3(10)) | "data in electronic form which is attached to or logically associated with other data in electronic form and which is used by the signatory to sign" | **Met by Phase 2 design** — drawn signature + audit hash + ceremony token = SES. Admissible per Art. 25 ("not denied legal effect solely because in electronic form") but burden of proof on us. |
| **AdES** (Advanced Electronic Signature, eIDAS Art. 26) | (a) uniquely linked to signatory; (b) capable of identifying signatory; (c) created using data under signatory's sole control; (d) linked to signed data such that any subsequent change is detectable | **NOT met by Phase 2.** (a) and (b) partially via OTP-to-known-phone but the phone-binding is drafter-supplied, not externally certified. (c) requires the signatory to control private key material we don't issue. (d) met via PDF hash + MinIO WORM. **Out of scope for in-house MVP.** |
| **QES** (Qualified Electronic Signature, eIDAS Art. 3(12)) | AdES + qualified certificate from Qualified Trust Service Provider (QTSP) + qualified signature creation device (QSCD) | **NOT met.** Requires integration with a QTSP (e.g., certSIGN, DigiSign in Romania). Phase 3+ integration only. |

**What in-house Phase 2 satisfies:** SES with reinforced evidence (OTP, hash chain, TSA anchor) — legally admissible in EU courts for general commercial contracts NOT requiring specific form. **Not sufficient for:** real-estate transfers, employment contracts in some EU member states, public-administration filings, anything explicitly requiring AdES/QES by national law.

**BLOCK-MERGE items before prod release (lawyer review):**

- [ ] Evidence-bundle schema (`signerEvidence Json` structure) — does it satisfy "reasonable diligence" standard?
- [ ] Signer-facing copy ("by signing, you create a legally binding obligation") — Romanian + English; reviewed for enforceability.
- [ ] Retention schedule (10y) — matches Romanian Civil Code statute of limitations?
- [ ] Withdrawal-vs-cancellation distinction copy — clear, not misleading?
- [ ] DPIA artifact (`docs/dpia/e-sign.md`) — does it justify storing IP + UA for 10y under Art. 6(1)(f)?
- [ ] Audit-export format for court — does it meet evidentiary rules (Romanian Code of Civil Procedure Art. 285+)?

---

## Concrete TODO for `backend-engineer` (ordered, pre-merge mandatory)

Highest risk first (H×H) → then H×M → then M×M. Each item references the threat ID above.

### Block-merge (H×H or chain to H×H or legal block)

- [ ] **LEGAL** — Lawyer review of evidence-bundle schema + signer copy + retention + DPIA. Cannot ship to prod without sign-off. (Phase 2 §9 line 128 `[verificat]`.)
- [ ] **T-ESIGN-S-01** — OTP via Twilio SMS as second factor before signature submission; drafter supplies signer phone at request creation.
- [ ] **T-ESIGN-S-02** — Ceremony token: 32 bytes `crypto.randomBytes`, base64url, stored as sha256 `ceremonyTokenHash` (mirror PasswordReset pattern); rate-limit `/sign/<token>` to 10/min/IP; 14d default expiry; cron purges expired.
- [ ] **T-ESIGN-T-01** — MinIO object lock (WORM) on signed-contracts bucket; `pdfHash` re-verify on every GET; mismatch → 410 + alert; signed PDF stored at different key than preview.
- [ ] **T-ESIGN-T-02** — Template variable allow-list; pre-built scoped object; unknown token = empty + audit.
- [ ] **T-ESIGN-T-04** — Per-tenant hash chain `auditHashPrev`; daily TSA anchoring cron (RFC 3161); store TSR tokens.
- [ ] **T-ESIGN-T-05** — Multi-party strict order; `Contract.update` locked once any ceremony in non-terminal state.
- [ ] **T-ESIGN-R-01** — Full `signerEvidence Json` capture (OTP receipt, scroll-to-bottom, checkbox, click timestamps, drawing duration/strokes, typed name, IP prefix, UA family); both-party confirmation email immediately.
- [ ] **T-ESIGN-I-02** — `/sign/*` pages: `noindex` + `no-store`; PDF via short-TTL presigned URL; claim-before-PDF-GET flow.
- [ ] **T-ESIGN-E-01** — Signer email ≠ drafter email; signer email ≠ any User in tenant (OWNER override with reason).
- [ ] **T-ESIGN-E-02** — State machine for `Contract.status`; PATCH /contracts/:id rejects `status` in body; dedicated transition endpoints per role.
- [ ] **T-APPR-T-01** — Requester cannot supply approver chain; chain derived from policy and frozen as `policySnapshot`.
- [ ] **T-APPR-T-02** — `policySnapshot` immutable for in-flight requests; `ApprovalPolicy.version` increments on update.
- [ ] **T-APPR-T-03** — Decision endpoint guards: status check + step check + decider check; optimistic-concurrency UPDATE on `currentStepOrder`.
- [ ] **T-APPR-T-04** — Splitting-pattern detector as BI rule (`approval.split_pattern_detected` audit + dashboard flag).
- [ ] **T-APPR-T-06** — Per-trigger Zod schemas in `packages/shared/src/approval-triggers.ts`; ban `lodash.merge` in `approvals/`.
- [ ] **T-APPR-R-02** — Subject mutation lock during pending approval; `subjectSnapshot` on request creation; mutation-after-approval re-triggers review.
- [ ] **T-APPR-E-01** — Self-approval skip rule + all-skipped escalation to OWNER.
- [ ] **T-APPR-E-03** — Policy create/update/delete gated to `OWNER, ADMIN`; most-restrictive policy wins on tie.
- [ ] **T-APPR-E-04** — Centralize `maybeRequireApproval()`; coverage test enforces every trigger has an integration point.

### High priority (H×M or M×H)

- [ ] **T-ESIGN-S-03** — Reuse Phase 1 `TenantSendingDomain` for ceremony `From`.
- [ ] **T-ESIGN-T-03** — PNG-only signature, magic-byte check, sharp re-encode (600×200, 200KB), metadata strip; email render via presigned MinIO img-src.
- [ ] **T-ESIGN-D-01** — Per-tenant, per-user, per-(tenant, signer) ceremony quotas.
- [ ] **T-ESIGN-I-03** — Drafter brand name prominent in invitation; `From` bound to verified domain; abuse-report endpoint + auto-pause.
- [ ] **T-APPR-S-01** — Approval emails from verified domain; NO magic-link approval; auth required at app on click; context (policy + requester + amount) in body.
- [ ] **T-APPR-S-02** — Re-auth for decisions if session >5min or value > threshold; CSRF on decision POST.
- [ ] **T-APPR-I-01** — Approver RBAC check at notification time + at link-open; fail-closed to next approver / OWNER escalation.

### Medium priority (M×M)

- [ ] **T-ESIGN-R-02** — `contract.signature.request_created` audit with drafter context, 7y retention.
- [ ] **T-ESIGN-R-03** — Withdrawal-vs-cancellation distinction copy; cancellation only before signing; post-signing dispute is legal process.
- [ ] **T-ESIGN-I-01** — OTP-to-phone (already from T-ESIGN-S-01); drafter UI shows multi-geo-views indicator.
- [ ] **T-ESIGN-I-04** — IP-prefix-only by default; per-tenant pepper for full-IP escrow; privacy notice on sign page; DPIA artifact.
- [ ] **T-ESIGN-D-02** — Multipart body cap 1MB at Caddy; sharp timeout 5s, max 4096².
- [ ] **T-ESIGN-D-03** — PDF render in BullMQ queue, concurrency 4/tenant, 30s timeout, page-count cap.
- [ ] **T-APPR-T-05** — Per-(requester, subject) cap 3 in 24h; rejected requires NEW request linked via `previousRequestId`.
- [ ] **T-APPR-R-01** — `approval.decision.recorded` audit with full context, 7y.
- [ ] **T-APPR-I-02** — Comment field privacy hint; per-tenant retention config; DSAR full-text search over comments.
- [ ] **T-APPR-D-01** — Step count cap 10, parallel cap 5, notification dedup, daily digest >5 pending.
- [ ] **T-APPR-D-02** — Per-requester request quota; `approval.request.rate_limited` audit.

### Low priority (L×H or chain)

- [ ] **T-ESIGN-E-03** — Comment design invariant on `/sign/*` handler; cross-tenant integration test.
- [ ] **T-APPR-S-02** — Standard CSRF (already covered by global protection).
- [ ] **T-APPR-E-02** — No delegation in Phase 2 MVP; documented.
- [ ] **T-APPR-I-03** — Integration test for cross-tenant isolation on approvals endpoints.

---

## AUTHZ matrix delta (update `docs/ACCESS_CONTROL_MATRIX.md`)

| Operation | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|---|---|---|---|---|
| `contract.template.create` | x | x | — | — | — |
| `contract.template.update` | x | x | — | — | — |
| `contract.template.delete` | x | x | — | — | — |
| `contract.signature.request_create` | x | x | x | x | — |
| `contract.signature.request_cancel` | x | x | x | — | — |
| `contract.signature.audit.read` | x | x | x | — | — |
| `contract.signature.internal_signer_override` | x | — | — | — | — |
| `contract.status.transition` (any status mutation) | x | x | — | — | — |
| `contract.export.legal_pack` (for court / audit export) | x | x | — | — | — |
| `approval.policy.create` | x | x | — | — | — |
| `approval.policy.update` | x | x | — | — | — |
| `approval.policy.delete` | x | x | — | — | — |
| `approval.request.create` | (system-triggered from subject mutator — not directly callable) | | | | |
| `approval.request.list` | x | x | x | x (own only) | — |
| `approval.request.cancel` (requester only) | x | x | x | x (own only) | — |
| `approval.decision.create` | (resolved approver per policy step only) | | | | |
| `approval.decision.list` | x | x | x | x (own decisions) | — |

---

## Audit events delta (`apps/api/src/modules/audit/audit-events.ts`)

E-sign:
- `contract.template.created`
- `contract.template.updated`
- `contract.template.deleted`
- `contract.template.unknown_token`
- `contract.template.render_timeout`
- `contract.signature.request_created`
- `contract.signature.otp_sent`
- `contract.signature.otp_failed`
- `contract.signature.otp_verified`
- `contract.signature.ceremony_viewed`
- `contract.signature.pdf_hash_mismatch`
- `contract.signature.payload_oversized`
- `contract.signature.rate_limited`
- `contract.signature.submitted`
- `contract.signature.cancelled`
- `contract.signature.internal_signer_override`
- `contract.status.transitioned`
- `contract.audit.timestamped`
- `tenant.abuse.signature_phishing_reported`

Approvals:
- `approval.policy.created`
- `approval.policy.updated`
- `approval.policy.deleted`
- `approval.policy.deleted_with_inflight`
- `approval.request.created`
- `approval.request.rate_limited`
- `approval.request.resubmit_capped`
- `approval.request.cancelled`
- `approval.decision.recorded`
- `approval.decision.reauth_required`
- `approval.step.skipped_self_approval`
- `approval.notification.sent`
- `approval.notification.skipped_approver_no_access`
- `approval.approver.access_denied`
- `approval.split_pattern_detected`
- `approval.subject.locked_for_mutation`
- `approval.subject.mutation_after_approval_triggered_re_review`

Retention guidance:
- `contract.signature.*` (any mutation, including OTP events) + `contract.audit.timestamped` + `contract.template.*` + `contract.status.transitioned` → **10 years** (Romanian Civil Code general obligations statute of limitations; matches contract retention).
- `approval.policy.*` + `approval.decision.recorded` + `approval.request.created` → **7 years** (regulatory + dispute defense).
- `approval.subject.*` + `approval.notification.*` → **2 years** (operational).
- `*.rate_limited`, `*.cancelled`, `*.failed`, `contract.signature.payload_oversized`, `contract.template.unknown_token` → **90 days** (noise / fraud-investigation window).
- `tenant.abuse.signature_phishing_reported` → **7 years** (regulatory + brand-defense).

---

## Handoff

- **`backend-engineer`**: this document is your input. Implement TODO list top-down (LEGAL block-merge first — get sign-off scheduled even if work continues in parallel). The `ContractSignatureCeremony` + `ContractSignature` schema + state machine + OTP integration are the structural prerequisites for the rest of the e-sign hardening. For approvals: the polymorphic `subjectType`/`subjectId` migration + `policySnapshot` immutability are the structural prerequisites. Phase 2 has a hard dependency on Phase 1 deliverables: `TenantSendingDomain` (T-CB-S-01), `OutboxEvent` (T-WH-T-05 — for notification reliability), MinIO presigned-URL pattern (already in stack). Do NOT start e-sign work until Phase 1's `TenantSendingDomain` is shipped.
- **`security-red-team`**: after backend-engineer implements, run adversarial review against the threat IDs above — try actual exploits: brute-force enumerate ceremony tokens (100k requests), upload SVG-as-PNG signature, replay submitted signature with crafted timestamp, race-condition double-submit on decision endpoint, post `__proto__` in policy.config, split a $20k subject into 2×$10k to bypass VP-approval policy, edit policy mid-flight and assert in-flight uses snapshot, request as user A with approver A (self-approval), forward ceremony URL to second browser and try to sign without OTP.
- **`qa-automation`**: e2e scaffolds in `test/e-sign.e2e.spec.ts`, `test/approvals.e2e.spec.ts` should include at least one test per H×H threat ID. Specifically: full sign ceremony with OTP success + OTP failure, PDF-hash-mismatch alert, multi-party ordered sign, contract locked-for-edit during signing, approval chain with self-approval skip, policy version isolation for in-flight, subject mutation lock.
- **`security-blue-team`**: verify all new audit events flow to SIEM; verify RLS active on new tables (`contract_templates`, `contract_signature_ceremonies`, `contract_signatures`, `approval_policy_steps`); verify TSA-anchoring cron is running + alerting on TSA outages; verify MinIO WORM bucket policy applied; verify retention crons (10y / 7y / 2y / 90d) running with correct grace.
- **`compliance`**: DPIA artifact `docs/dpia/e-sign.md`; DPA addendum language for ceremony evidence + IP/UA processing under Art. 6(1)(f); coordinate lawyer review per LEGAL block-merge.
- **`design`**: signer-facing UX (drawing canvas, scroll-to-bottom enforcement, OTP entry screen, "legally bound" copy + checkbox); approver UX (notification email body, decision page with subject snapshot diff, re-auth prompt); drafter UX (ceremony creation form with signer phone + OTP channel choice, multi-geo-views indicator).

## STRIDE coverage scorecard

| Feature | S | T | R | I | D | E | Total |
|---|---|---|---|---|---|---|---|
| E-sign on contracts | 3 | 5 | 3 | 4 | 3 | 3 | 21 |
| Approval workflows multi-step | 2 | 6 | 2 | 3 | 2 | 4 | 19 |
| **Total** | **5** | **11** | **5** | **7** | **5** | **7** | **40** |

All six STRIDE categories addressed for each feature. No category empty. E-sign has highest R count (repudiation is the central legal concern for SES); approvals has highest T count (most state-machine + policy-snapshot integrity threats).
