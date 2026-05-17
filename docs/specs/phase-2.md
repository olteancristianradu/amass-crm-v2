# Phase 2 — Closing the deal: Acceptance Criteria (Gherkin)

> **Status:** DRAFT · **Owner:** `product-manager` sub-agent · **Date:** 2026-05-17
> **For:** `backend-engineer` + `frontend-engineer` + `qa-automation` + `qa-manual` + `code-reviewer` + `security-red-team` + `accessibility-auditor` + `ux-designer`
> **Source plan:** [`docs/ROADMAP_V2.md`](../ROADMAP_V2.md) §2 Phase 2 (Closing the deal, 3 weeks)
> **Rule reference:** [`CLAUDE.md`](../../CLAUDE.md) #2 (proof of done), #3 (tenant isolation), #6 (no scope creep), #8 (coverage), #11 (lint+test), #14 (async error propagation)
> **Predecessor specs:** [`phase-0.md`](./phase-0.md) (i18n + multi-currency + saved-views), [`phase-1.md`](./phase-1.md) (campaigns + tracking + webhooks)

Inline markers:
- `[verificat]` — read live from code/schema today (2026-05-17)
- `[propus]` — not yet in repo, must be created or migrated in Phase 2
- `[presupun]` — inference; flagged for sign-off before merge
- `[depășește contextul]` — outside this agent's visibility (e.g. lawyer review)

---

## Reality check — 2026-05-17, executed live

**Modules already scaffolded (we are NOT starting from zero):**
- `apps/api/src/modules/contracts/` — `contracts.{service,controller,module}.ts` + `contracts.service.spec.ts` `[verificat]`. CRUD pe `Contract` model, Cedar-guarded mutate, `RolesGuard` enforced. `findAll` supports `companyId`, `status`, `expiringInDays` filters, cursor pagination, `runWithTenant` boundary on every query, soft-delete via `deletedAt`. NO signing flow exists — `signedAt` is a manually-settable field, no ceremony, no audit hash. `storageKey String?` field exists for an attached PDF but no generator wired.
- `apps/api/src/modules/approvals/` — `approvals.{service,controller,module}.ts` + `approvals.service.spec.ts` `[verificat]`. Implements **single-step** approval today: `ApprovalPolicy(trigger='QUOTE_ABOVE_VALUE'|'DISCOUNT_ABOVE_PCT', approverId?)` → `ApprovalRequest(status=PENDING)` per matching policy → first `decide(APPROVED|REJECTED)` flips the quote to `SENT` or back to `DRAFT`. No multi-step ordering, no graph, no SLA timer, no notifications wired. Only `Quote` subject is wired (`approvalRequest.quoteId` is a typed FK). Cedar permissions: `approval-policy::{create,update,delete}`, `approval-request::decide` `[verificat]`.

**Schema reality (`apps/api/prisma/schema.prisma`):**
- `Contract` at line 2249 `[verificat]`: `id, tenantId, companyId, title, description?, value(Decimal 14,2)?, currency(default 'RON'), status ContractStatus, signedAt?, startDate?, endDate?, renewalDate?, autoRenew, storageKey?, createdById?, createdAt, updatedAt, deletedAt`. **NO** `Signer`, `SigningCeremony`, `SignatureEvent`, `SignatureAuditHash` — all new in Phase 2 `[propus]`.
- `ContractStatus` enum at 2241: `DRAFT, ACTIVE, EXPIRED, TERMINATED, RENEWED`. **Missing for e-sign lifecycle:** `OUT_FOR_SIGNATURE, PARTIALLY_SIGNED, SIGNED, DECLINED, VOIDED` `[propus]`. Add additively — `ACTIVE` becomes the post-signature operational state (signed + countersigned + within `startDate..endDate`).
- `ApprovalPolicy/Request/Decision` at 1608/1630/1650 `[verificat]`: single-step. **Phase 2 additions** `[propus]`: `ApprovalStep` table (ordered chain per request), `ApprovalNotification` log (email + in-app dispatch outcome), `ApprovalRequestSubject` polymorphic columns (`subjectType ApprovalSubjectType, subjectId String`) so we can approve **Contract** + **Quote** (and prep for Deal/Discount in Phase 3 without another migration). Keep the typed `quoteId` FK as a generated column for back-compat through one release, then drop in Phase 3.
- `ApprovalStatus` at 1595: `PENDING, APPROVED, REJECTED, CANCELLED`. **Add** `EXPIRED, WITHDRAWN` `[propus]` for SLA timeout and requester self-cancel — distinguishing intent matters for audit (`WITHDRAWN` is requester-driven, `CANCELLED` is system/admin-driven, `EXPIRED` is the SLA timer firing).

**Stack inventory:**
- `pdfkit ^0.15.2` is already in `apps/api/package.json:71` `[verificat]` with `@types/pdfkit ^0.17.6`. **Decision D2 below: keep `pdfkit`, do NOT add puppeteer or pdf-lib.** Existing invoice/quote PDFs presumably use it; reuse for contract rendering.
- `fast-check` is **NOT** in any package.json `[verificat: grep returned 0 results]`. Property-based testing for the approval state machine requires adding `fast-check ^3` to `apps/api/devDependencies` `[propus]`.
- `signature_pad` (HTML5 canvas signature lib) is **NOT** in `apps/web/package.json` `[verificat]`. Add `signature_pad ^4` to `apps/web/dependencies` `[propus]`. ~20 KB gzipped, MIT, maintained, accessible API.
- `@dnd-kit/core` is presumably already present from Phase 1 campaign builder; not needed here.
- BullMQ queues exist (`queue.constants.ts`); add new queue `signature-reminders` for ceremony nudges + expiry sweeps `[propus]`.
- Email pipeline (`EmailService.sendTransactional`) ready `[verificat: phase-1.md §F1 reality check]` — reused for ceremony invite + reminder emails.
- Notifications gateway (Socket.IO) exists `[verificat: SEC-005 in CHANGELOG]` — reused for in-app approval inbox real-time updates.

**Phase 1.1.1 follow-ups inherited into Phase 2 polish week (per ROADMAP_V2 §2 + CHANGELOG):**
1. CRIT-1 full — `TenantSendingDomain` model + DKIM verify + `fromAddress` whitelist (largest item)
2. HIGH-4 — Per-event Zod payload schemas for webhook events
3. T-MAIL-T-03 — HTML body sanitizer (cheerio/DOMPurify) for `injectTracking`
4. T-MAIL-D-01 — `@Throttle` decorator on `/e/t/*` tracking endpoints
5. MED-4 + MEDIUM-1 — Outbox retention cron + suspended-tenant outbox cleanup
6. I-2 — Wire `CampaignRecipientsService.recordEvent` from `EmailTrackingService.recordOpen/Click`
7. I-3 — `EmailService.sendTransactional` calls `injectTracking` (engagement reporting for workflow-driven emails)

**Pre-baked decisions (NO user sign-off needed — defaults applied):**

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | E-sign approach | **In-house** — PDF + signature canvas + audit hash, SES level only | ROADMAP_V2 §9 default; defer DocuSign API to Phase 3 if client demand emerges |
| D2 | PDF generator | **`pdfkit`** (already in deps) | Zero new heavy deps (puppeteer = Chromium download ~280 MB); 6 block types fit linear PDF layout |
| D3 | Multi-signer ordering | **Ordered (sequential)** for MVP | Simpler audit trail, matches B2B contract reality (each party countersigns in turn); parallel mode is Phase 3 |
| D4 | Signer authentication | **Email link with HMAC token** (no separate login required) | eIDAS SES (Simple Electronic Signature) spec; AdES upgrade is Phase 5 |
| D5 | Signature image format | **PNG base64 inline** (canvas `.toDataURL('image/png')`) | SVG vector = XSS surface (foreign object, embedded scripts); PNG is render-only |
| D6 | Ceremony expiry | **14 days default**, configurable per tenant via `TenantSetting('contract.signature.ceremony_ttl_days')` | Industry median between DocuSign (default 30d) and HelloSign (default 30d) — shorter = better security hygiene |
| D7 | Approval delegation | **NO** (delegate-to-assistant pattern) | Adds proxy-trust audit complexity; Phase 3 candidate |
| D8 | Conditional approval | **NO** ("amount > X requires VP" beyond linear chain) | MVP = ordered linear chain only; per-step conditions = Phase 3 |
| D9 | Audit log readers | OWNER + ADMIN + contract owner (`createdById`) | Need-to-know basis; MANAGER and below blocked from PDF-hash + IP audit trail |
| D10 | Signed-contract retention | **7 years** default, configurable via `TenantSetting('contract.retention_years')` | Romanian Codul Fiscal Art. 25 for commercial contracts |
| D11 | Reminder cadence | **3 reminders**: T+3 days, T+7 days, T+12 days (24h before expiry) | Matches DocuSign default; balance between nudge and spam |
| D12 | Signer geo / device capture | **IP + UA only** (NO geo lookup, NO device fingerprinting) | Privacy-minimal, sufficient for SES audit; geo = GDPR scope-creep |

**Decisions to flag for user sign-off (block work until answered):**

| # | Topic | Options | Recommendation |
|---|---|---|---|
| Q1 | Self-sign by tenant rep first (countersign) | A: tenant signs first, then external signer; B: external signer first, then tenant countersigns; C: order configurable per ceremony | **C** — let user pick per contract; default to A (tenant initiates, sends out, countersigns at the end) |
| Q2 | Approval inbox UI placement | A: dedicated `/app/approvals` route; B: badge on global nav + dropdown; C: both | **C** — route for triage, badge for awareness; minor extra effort |
| Q3 | Block signing without lawyer-reviewed eIDAS opinion | A: ship to staging, lawyer reviews before prod flag flip; B: lawyer review before any code lands | **A** — code in main, feature flag `CONTRACT_ESIGN_ENABLED=false` in prod env until lawyer signs the DPIA + SES compliance memo `[depășește contextul]` |
| Q4 | Contracts denominated in foreign currency at signing | A: snapshot FX rate at signing into Contract; B: just show currency, no FX snapshot | **A** — already a Phase 0 capability (`Deal.amountBase + fxRateAt`), reuse for `Contract.valueBase + fxRateAt` for forecast roll-up |

---

## Feature F1 — E-sign on contracts (in-house, eIDAS SES)

**Effort:** 7 days (roadmap §2 P2). **Realistic adjusted:** 7-9 days because nothing exists for signature today (vs. F2 where the skeleton is half-built).

### Schema additions `[propus]`

```prisma
enum ContractStatus {
  DRAFT
  OUT_FOR_SIGNATURE   // NEW — ceremony sent, no party signed yet
  PARTIALLY_SIGNED    // NEW — at least one signer done, others outstanding (multi-signer ordered)
  SIGNED              // NEW — all signers complete, fully executed
  DECLINED            // NEW — at least one signer refused
  VOIDED              // NEW — sender canceled before completion
  ACTIVE              // post-signature operational state, within startDate..endDate
  EXPIRED             // existing: past endDate
  TERMINATED          // existing
  RENEWED             // existing
}

enum SignerRole {
  TENANT_REP          // internal user from the issuing tenant
  COUNTERPARTY        // external person (lead/contact)
  WITNESS             // optional, not enforced for SES
}

enum SignerStatus {
  PENDING             // not their turn yet (ordered ceremony)
  NOTIFIED            // ceremony URL emailed, not yet opened
  VIEWED              // signer opened ceremony page
  SIGNED
  DECLINED
  EXPIRED
}

model ContractSigner {
  id                String        @id @default(cuid())
  tenantId          String        @map("tenant_id")
  contractId        String        @map("contract_id")
  // null for external counterparty; set for internal tenant user
  userId            String?       @map("user_id")
  // external identity capture
  email             String        @db.VarChar(254)
  fullName          String        @db.VarChar(200)
  role              SignerRole
  // 1-based position in the ordered ceremony; signer N can sign only after 1..N-1 are SIGNED
  signOrder         Int           @map("sign_order")
  status            SignerStatus  @default(PENDING)
  // HMAC token for the signer's ceremony URL — see Story F1.2
  // stored as sha256 of the raw token; raw never persisted
  ceremonyTokenHash String        @map("ceremony_token_hash") @db.Char(64)
  // when the row was rendered into the email + sent
  notifiedAt        DateTime?     @map("notified_at")
  viewedAt          DateTime?     @map("viewed_at")
  signedAt          DateTime?     @map("signed_at")
  declinedAt        DateTime?     @map("declined_at")
  declineReason     String?       @db.VarChar(500) @map("decline_reason")
  // SES audit capture — set on terminal action
  ipAddress         String?       @map("ip_address")     // IPv4/IPv6 textual
  userAgent         String?       @db.VarChar(500) @map("user_agent")
  // base64 PNG of the drawn signature; null until SIGNED
  signatureImagePng String?       @map("signature_image_png") // TEXT; ~6-20 KB typical
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedAt         DateTime      @updatedAt @map("updated_at")

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@unique([contractId, signOrder])
  @@index([tenantId, contractId])
  @@index([tenantId, status])
  // partial unique to support resend without leaking old tokens
  @@index([ceremonyTokenHash])
  @@map("contract_signers")
}

model ContractSignatureEvent {
  id           String   @id @default(cuid())
  tenantId     String   @map("tenant_id")
  contractId   String   @map("contract_id")
  signerId     String?  @map("signer_id")
  // CEREMONY_CREATED | INVITE_SENT | INVITE_OPENED | SIGNED | DECLINED | REMINDER_SENT | VOIDED | EXPIRED | RESEALED
  eventType    String   @db.VarChar(40) @map("event_type")
  // sha256 hex over (pdfHash || signerId || ip || ua || timestampIso) — see F1.4
  auditHash    String   @db.Char(64) @map("audit_hash")
  // raw event payload for forensic replay — what changed, who, when
  payload      Json
  ipAddress    String?  @map("ip_address")
  userAgent    String?  @db.VarChar(500) @map("user_agent")
  createdAt    DateTime @default(now()) @map("created_at")

  contract Contract       @relation(fields: [contractId], references: [id], onDelete: Cascade)
  signer   ContractSigner? @relation(fields: [signerId], references: [id], onDelete: SetNull)

  @@index([tenantId, contractId, createdAt])
  @@map("contract_signature_events")
}

model Contract {
  // ... existing fields ...
  // NEW for e-sign:
  pdfStorageKey      String?   @map("pdf_storage_key")       // MinIO key for the rendered base PDF (without signatures applied)
  pdfHashSha256      String?   @map("pdf_hash_sha256") @db.Char(64)  // hex; locked at ceremony start, mismatched at re-render = void
  signedPdfStorageKey String?  @map("signed_pdf_storage_key")  // MinIO key for the FINAL signed PDF (with signature images + audit page)
  signedPdfHashSha256 String?  @map("signed_pdf_hash_sha256") @db.Char(64)
  ceremonyStartedAt  DateTime? @map("ceremony_started_at")
  ceremonyExpiresAt  DateTime? @map("ceremony_expires_at")
  templateMarkdown   String?   @map("template_markdown") @db.Text  // source template — Markdown subset, rendered to PDF via pdfkit
  // Phase 0 FX consistency:
  valueBase          Decimal?  @db.Decimal(14, 2) @map("value_base")
  fxRateAt           DateTime? @map("fx_rate_at")

  signers ContractSigner[]
  signatureEvents ContractSignatureEvent[]
}
```

Migration files `[propus]`:
- `2026XXXX_phase2_contract_signing_enums.sql` — adds new enum values to `ContractStatus`, creates `SignerRole`, `SignerStatus`.
- `2026XXXX_phase2_contract_signing_tables.sql` — `contract_signers`, `contract_signature_events`, plus new columns on `contracts`. ENABLE/FORCE RLS + GRANTs to `app_user` (matches Phase 1 pattern per CHANGELOG line 25).

---

### Story F1.1 — Tenant rep creates a contract from a template and configures signers

**As a** sales rep `radu@acme.ro` (role MANAGER) at tenant `acme-ro`
**I want** to draft a contract from a Markdown template, attach signers in order, and review before sending
**So that** I can replace the current "print + scan + email back" workflow with a single in-app ceremony

#### Scenario: Draft a contract from template + add 2 signers (happy path)
```gherkin
Given radu is on /app/companies/cmp_globex/contracts and clicks "Contract nou"
  And radu fills the form: title="MSA 2026 — Acme × Globex", value=120000, currency="RON", startDate=2026-06-01, endDate=2027-05-31, templateMarkdown="# Master Services Agreement\n\n## Party A: {{tenant.name}}\n## Party B: {{company.name}}\n..."
When radu submits POST /api/v1/contracts { companyId: 'cmp_globex', title, value, currency, startDate, endDate, templateMarkdown }
Then the response is 201 with { id: 'ctr_abc', status: 'DRAFT', pdfStorageKey: null, signedPdfStorageKey: null, ... }
  And a row exists in contracts: tenantId='acme-ro', createdById=radu.id, status='DRAFT'
  And Phase 0 FX is applied: if currency != tenant.baseCurrency, valueBase + fxRateAt populated via FxRatesService.convert [verificat: phase-0.md F2 reuse]
  And the contract is created INSIDE runWithTenant('acme-ro', ...) and RLS GRANT ensures app_user write
When radu calls POST /api/v1/contracts/ctr_abc/signers with body [
    { fullName: 'Radu Oltean', email: 'radu@acme.ro', role: 'TENANT_REP', signOrder: 2 },
    { fullName: 'John Globex', email: 'john@globex.com', role: 'COUNTERPARTY', signOrder: 1 }
  ]
Then the response is 201 with 2 ContractSigner rows in the response array, both status='PENDING'
  And the (contractId, signOrder) unique constraint rejects duplicate orders with 409 SIGNER_ORDER_CONFLICT
  And the email field is normalized: trimmed, lowercased (defense against case-collision evasion)
  And NO ceremonyTokenHash is set yet (only at /send)
  And audit log writes { action: 'contract.signer.added', subjectType: 'contract', subjectId: 'ctr_abc', metadata: { signOrder, role, email } }
```

#### Scenario: Generate PDF preview before sending
```gherkin
Given ctr_abc has status='DRAFT', templateMarkdown set, 2 signers configured
When radu calls POST /api/v1/contracts/ctr_abc/preview-pdf
Then the system renders templateMarkdown → PDF via pdfkit (using D2 decision):
    - Page A4, 12pt body, 18pt H1, 14pt H2, monospace for code blocks
    - Placeholders interpolated: {{tenant.name}} → "Acme SRL", {{company.name}} → "Globex Corp", {{contract.value}} → "120.000,00 RON", {{contract.startDate}} → "01.06.2026" (ro-RO format)
    - Signature blocks rendered as empty boxes at the end: "Semnătura Party A: __________  Data: ____"
    - Footer page: "Generated by Amass CRM at {{now}} — Document UID: ctr_abc"
  And the response is 200 with body = application/pdf, Content-Disposition: inline; filename="MSA_2026_Acme_Globex_preview.pdf"
  And NO row state changes (preview is stateless re-render)
  And the audit log records { action: 'contract.preview.generated', subjectId: 'ctr_abc' }
  And HTML/template-injection guard: any `{{...}}` token NOT in the allowlist renders literally as "{{unknown_token}}" + warn log
```

#### Scenario: Template token allowlist enforced
```gherkin
Given templateMarkdown contains "{{eval(process.exit)}}" or "{{tenant.adminPasswordHash}}"
When the renderer runs
Then both tokens render as literal text "{{eval(process.exit)}}" and "{{tenant.adminPasswordHash}}" (no eval, no field access outside allowlist)
  And allowlist [verificat in spec]: tenant.name, tenant.taxId, tenant.address, company.name, company.taxId, company.address, contract.title, contract.value (formatted), contract.currency, contract.startDate, contract.endDate, contract.id, sender.fullName, signer.fullName, signer.email, now (ISO), today (ro-RO)
  And a warn log emits per unknown token: { msg: 'contract.template.token.unknown', token, contractId }
```

#### Scenario: Cross-tenant denied — Tenant B cannot read Tenant A's contract
```gherkin
Given tenant acme-ro has ctr_abc
  And user john@globex (tenant globex) is authenticated
When john calls GET /api/v1/contracts/ctr_abc
Then the response is 404 { code: 'CONTRACT_NOT_FOUND' } [verificat: contracts.service.ts:70-72 pattern]
  And NO data leaks
  And john calling POST /api/v1/contracts/ctr_abc/signers also returns 404 (existence-based)
```

---

### Story F1.2 — Send ceremony — locks PDF hash, emails signers in order

**As a** sales rep
**I want** to "send" the contract — locking the PDF and emailing only the next-in-line signer
**So that** signers can't see drafts in flux and the audit trail starts with a canonical PDF

#### Scenario: Send transitions DRAFT → OUT_FOR_SIGNATURE, locks pdfHash, emails signer #1
```gherkin
Given ctr_abc has status='DRAFT' with 2 signers [john@globex (order 1), radu@acme.ro (order 2)]
  And TenantSetting('contract.signature.ceremony_ttl_days') is missing (uses default 14, per D6)
When radu calls POST /api/v1/contracts/ctr_abc/send
Then the system runs in a single tx (runWithTenant + tenantExtension):
  1. Renders the final PDF via pdfkit → uploads to MinIO at key "tenants/acme-ro/contracts/ctr_abc/base.pdf"
  2. Computes pdfHashSha256 = sha256_hex(pdfBytes), persists on contract row
  3. Sets contract.status='OUT_FOR_SIGNATURE', ceremonyStartedAt=now(), ceremonyExpiresAt=now()+14 days
  4. For EACH signer: generates raw token = base64url(crypto.randomBytes(32)), stores sha256_hex(token) in ceremonyTokenHash, raw token discarded after email send
  5. Inserts ContractSignatureEvent { eventType: 'CEREMONY_CREATED', auditHash: sha256(pdfHash || contractId || now()), payload: { signers: [...] } }
  6. For SIGNER #1 ONLY (signOrder=1 = john): calls EmailService.sendTransactional({
       to: 'john@globex.com',
       subject: 'Semnați contractul "MSA 2026 — Acme × Globex"',
       templateKey: 'contract.ceremony.invite',
       variables: { signerName, contractTitle, ceremonyUrl: 'https://app.amasscrm.ro/s/<rawToken>', expiresInDays: 14, senderName: 'Radu Oltean' }
     })
  7. Signer #1 row → status='NOTIFIED', notifiedAt=now()
  8. Signer #2 row stays status='PENDING' (NOT notified — ordered ceremony per D3)
  9. ContractSignatureEvent inserted: { eventType: 'INVITE_SENT', signerId: signer1.id }
  10. Webhook outbox publishes 'CONTRACT_SENT_FOR_SIGNATURE' to subscribers [propus: extends Phase 1 webhook enum]
And the response is 200 with { id: 'ctr_abc', status: 'OUT_FOR_SIGNATURE', ceremonyExpiresAt: '2026-05-31T...Z', signers: [{ ...status: 'NOTIFIED' }, { ...status: 'PENDING' }] }
And the email is queued, NOT yet delivered (the BullMQ 'email' job runs out-of-tx)
```

#### Scenario: Send rejected when prerequisites incomplete
```gherkin
Given ctr_abc has no signers configured (or zero TENANT_REP signers, or templateMarkdown is null)
When radu calls POST /api/v1/contracts/ctr_abc/send
Then the response is 400 { code: 'CONTRACT_INCOMPLETE', details: { missing: ['signers', 'templateMarkdown'] } }
  And NO state transition, NO email, NO PDF render
```

#### Scenario: Send rejected if contract already out for signature
```gherkin
Given ctr_abc.status='OUT_FOR_SIGNATURE'
When radu calls POST /api/v1/contracts/ctr_abc/send a second time
Then the response is 409 { code: 'CONTRACT_NOT_DRAFT', message: 'Only DRAFT contracts can be sent for signature' }
  And NO new tokens are generated (defeats accidental re-token race where the in-flight signer's token would be silently invalidated)
```

#### Scenario: Ceremony URL token is single-use per signer
```gherkin
Given signer #1 receives email with ceremonyUrl 'https://app.amasscrm.ro/s/<rawToken>'
When signer GETs the URL
Then the server hashes the raw token (sha256_hex) and looks up ContractSigner WHERE ceremonyTokenHash = ... AND status IN ('NOTIFIED', 'VIEWED')
  And on match: sets status='VIEWED' on first GET (transition NOTIFIED → VIEWED), idempotent on re-fetch
  And renders the signing page (read-only PDF preview + signature canvas)
  And inserts ContractSignatureEvent { eventType: 'INVITE_OPENED', signerId, ipAddress: req.ip, userAgent: req.headers['user-agent'] }
  And on token miss OR status NOT IN allowed: returns 404 generic "Link expired or invalid" page (NO leak of which contract / which signer)
```

#### Scenario: Expired ceremony — signer hits page after ceremonyExpiresAt
```gherkin
Given ceremonyExpiresAt is 2026-05-30T10:00:00Z
  And clock is now 2026-05-30T10:00:01Z
When signer GETs the ceremony URL
Then the response is 410 GONE { html: "Ceremonia a expirat. Contactați expeditorul pentru un nou link." }
  And the signer row status transitions to 'EXPIRED' (idempotent set)
  And ContractSignatureEvent inserted { eventType: 'EXPIRED', signerId }
  And NO further sign attempt is accepted even if signer somehow retains the URL
```

#### Scenario: Signer auth via email-link is the ONLY allowed flow (D4)
```gherkin
Given an authenticated tenant user tries to bypass: POST /api/v1/contracts/ctr_abc/sign-direct { signerId, signaturePng }
Then the endpoint does NOT exist (404). Signing is REQUIRED to go through the public /s/<token> flow even for TENANT_REP role signers — same audit pipeline, same IP+UA capture
  And TENANT_REP signers receive their email via the same EmailService.sendTransactional call (just routes to their own inbox)
```

---

### Story F1.3 — Counterparty draws signature on canvas, signs

**As a** counterparty `john@globex.com` (no Amass CRM account)
**I want** to draw my signature on a touch-capable canvas and submit
**So that** I can execute the contract without creating an account or printing

#### Scenario: Sign happy path with valid PNG signature
```gherkin
Given john has loaded GET /s/<rawToken> (status=VIEWED, signer row visible)
  And john has drawn a signature on the canvas (signature_pad library, D5)
  And the canvas serialized to data:image/png;base64,iVBORw0KGgo...
When john submits POST /api/v1/public/contracts/sign { token: '<rawToken>', signatureImagePng: '<base64>', acceptedAt: '2026-05-18T10:30:00Z' }
Then the server:
  1. Re-validates token (same hash lookup as F1.2 VIEWED scenario)
  2. Re-fetches contract.pdfHashSha256 from DB; re-fetches PDF from MinIO; recomputes sha256 over bytes; ASSERTS equality → if mismatch, contract is VOIDED, signer sees "Document modificat după trimitere — contactați expeditorul" (defense against bypassing tamper-evident lock)
  3. Validates signatureImagePng: data URL prefix data:image/png;base64,; base64 decodes cleanly; PNG magic bytes (89 50 4E 47); dimensions ≤ 1200×400 px; byte size ≤ 50 KB; no chunks beyond IHDR/IDAT/IEND/sRGB/gAMA/pHYs (defense against PNG payload smuggling)
  4. Persists signer row update: status='SIGNED', signedAt=now(), ipAddress=req.ip, userAgent=req.headers['user-agent'], signatureImagePng=<sanitized base64>
  5. Computes auditHash = sha256_hex([pdfHashSha256, signerId, req.ip, req.headers['user-agent'], signedAt.toISOString()].join('|'))
  6. Inserts ContractSignatureEvent { eventType: 'SIGNED', signerId, auditHash, payload: { signOrder: 1 }, ipAddress, userAgent }
  7. If MORE signers in order (signer #2 PENDING): contract.status='PARTIALLY_SIGNED'; emails signer #2 (same template as F1.2); signer #2 → 'NOTIFIED'; ContractSignatureEvent 'INVITE_SENT' for #2
  8. If THIS WAS THE LAST signer: see Story F1.5 (finalization)
And the response is 200 { message: 'Semnătură înregistrată. Mulțumim.', contractStatus: 'PARTIALLY_SIGNED' OR 'SIGNED' }
And the original ceremony URL is now invalid for further submissions (status check guards against replay)
```

#### Scenario: Tampered PDF detection — pdfHash mismatch
```gherkin
Given an attacker (or admin via direct DB write) modifies the base PDF in MinIO between ceremony send and john's signature submission
When john submits the signature
Then step 2 of F1.3 fails: contract.pdfHashSha256 != sha256(currentPdfBytes)
  And the contract.status='VOIDED'
  And ContractSignatureEvent { eventType: 'VOIDED', payload: { reason: 'PDF_HASH_MISMATCH', expected: 'abc...', actual: 'def...' } }
  And the response is 409 { code: 'CONTRACT_TAMPERED', message: 'The document changed after it was sent. The ceremony is voided.' }
  And the audit log writes a SECURITY-level entry: { action: 'contract.tamper_detected', severity: 'HIGH', subjectId: 'ctr_abc' }
  And Sentry alert: { tag: 'contract-tamper', contractId, tenantId }
  And NO signature is persisted
  And NO emails are sent
```

#### Scenario: Decline — signer refuses
```gherkin
Given john loads the ceremony page
When john submits POST /api/v1/public/contracts/decline { token: '<rawToken>', reason: 'Termenii contractului nu sunt acceptabili.' }
Then signer row: status='DECLINED', declinedAt=now(), declineReason=<sanitized 500-char max>
  And contract.status='DECLINED'
  And ContractSignatureEvent { eventType: 'DECLINED', signerId, payload: { reason } }
  And ALL remaining PENDING signers get their tokens invalidated (status → 'EXPIRED' for them, NOT 'DECLINED' — they did not personally decline)
  And the sender (radu) receives an in-app + email notification: "John Globex a refuzat contractul MSA 2026: '<reason>'"
  And the response is 200 { message: 'Refuz înregistrat.', contractStatus: 'DECLINED' }
```

#### Scenario: Replay attack — same signature submitted twice
```gherkin
Given john already submitted his signature, status='SIGNED'
When an attacker (or john himself by accident) re-POSTs the same payload
Then the server's token lookup finds ceremonyTokenHash WHERE status IN ('NOTIFIED', 'VIEWED') — but john's row is now 'SIGNED', so no match
  And the response is 410 GONE { code: 'CEREMONY_ALREADY_COMPLETED', message: 'Ai semnat deja acest document.' }
  And NO second signer row, NO second event, NO new auditHash
```

#### Scenario: Race — two simultaneous submissions for same signer
```gherkin
Given two browser tabs both have the ceremony URL open (status=VIEWED)
When both submit POST /sign concurrently
Then ONE submission wins via SELECT ... FOR UPDATE on the signer row inside the runWithTenant tx
  And the second submission fails: SELECT returns status='SIGNED', the service returns 410 (same as replay scenario)
  And EXACTLY ONE ContractSignatureEvent { eventType: 'SIGNED' } row exists for the signer
  And the property-based test (fast-check) asserts: forall concurrent N submissions, signed_event_count = 1
```

#### Scenario: Malformed signature payload rejected
```gherkin
Given submission with signatureImagePng="data:text/html;base64,<svg onload=alert(1)>"
Then validation rejects (D5): not a PNG data URL
  And response 400 { code: 'INVALID_SIGNATURE', message: 'Signature must be a PNG image data URL' }
  And NO state change

Given submission with signatureImagePng=valid PNG data URL but 8 MB payload
Then validation rejects: byte size > 50 KB
  And response 413 { code: 'SIGNATURE_TOO_LARGE' }

Given submission with PNG containing unexpected ancillary chunk (e.g. tEXt with embedded HTML)
Then validation rejects: chunk allowlist (IHDR/IDAT/IEND/sRGB/gAMA/pHYs) violated
  And response 400 { code: 'INVALID_SIGNATURE_FORMAT' }
```

---

### Story F1.4 — Reminder cadence + auto-expiry

**As a** sender (Amass CRM operator)
**I want** the system to nudge signers automatically and expire stale ceremonies
**So that** deals don't quietly die because someone missed an email

#### Scenario: Reminder at T+3 days for NOTIFIED signer
```gherkin
Given signer #1 has status='NOTIFIED', notifiedAt='2026-05-18T10:00:00Z'
  And current time is '2026-05-21T10:00:01Z' (T+3 days, +1 second)
  And the BullMQ cron 'signature-reminders' runs every hour
When the cron tick processes pending reminders
Then the system finds signers WHERE status='NOTIFIED' AND (now() - notifiedAt) >= 3 days AND last reminder NOT in past 24h
  And sends EmailService.sendTransactional({ to: signer.email, templateKey: 'contract.ceremony.reminder', variables: { ... } })
  And inserts ContractSignatureEvent { eventType: 'REMINDER_SENT', signerId, payload: { reminderNumber: 1 } }
  And the 'last reminder' is tracked via the REMINDER_SENT events (count of those for the signer)
  And the reminder schedule per D11: T+3 (R1), T+7 (R2), T+12 days (R3 = 24h before expiry)
  And after R3, NO more reminders even if status remains NOTIFIED
```

#### Scenario: Reminder not sent if signer transitioned past NOTIFIED
```gherkin
Given signer #1 had status='NOTIFIED' but viewed the link yesterday → status='VIEWED'
When the cron runs
Then signer is INCLUDED (we remind VIEWED signers too — they saw it but didn't act)
  And the reminder template variant says "Am observat că ai vizualizat contractul, dar nu l-ai semnat încă..."

Given signer #1 has status='SIGNED' OR 'DECLINED' OR 'EXPIRED'
When the cron runs
Then NO reminder is sent (filtered by status NOT IN ('SIGNED','DECLINED','EXPIRED'))
```

#### Scenario: Auto-expiry at ceremonyExpiresAt
```gherkin
Given ctr_abc.ceremonyExpiresAt = '2026-06-01T10:00:00Z'
  And no signer has completed by '2026-06-01T10:00:00Z'
When the cron 'signature-reminders' tick falls after ceremonyExpiresAt
Then for the contract:
  - All non-terminal signers (status IN ('PENDING','NOTIFIED','VIEWED')) flip to status='EXPIRED'
  - contract.status='VOIDED' (if zero signers complete) OR remains 'PARTIALLY_SIGNED' (if some completed, some expired) → policy decision: PARTIALLY_SIGNED contracts that EXPIRE without finishing become 'VOIDED' (cannot be partially-executed legally)
  - ContractSignatureEvent { eventType: 'EXPIRED', payload: { reason: 'TTL_REACHED', expiredSignerIds } }
  - In-app + email notification to the sender (radu) and to OWNER role users
  - Webhook 'CONTRACT_VOIDED' fires [propus: enum addition]
```

#### Scenario: Sender voids manually
```gherkin
Given ctr_abc.status='OUT_FOR_SIGNATURE'
When radu calls POST /api/v1/contracts/ctr_abc/void { reason: 'Renegociere — termen nou.' }
Then contract.status='VOIDED', all non-terminal signers → 'EXPIRED'
  And ContractSignatureEvent { eventType: 'VOIDED', payload: { reason, voidedBy: radu.id } }
  And all signer tokens are invalidated (status flip blocks lookup)
  And reason is required (Zod min 1 char, max 500)
  And the response is 200 { contractStatus: 'VOIDED' }
  And audit log records { action: 'contract.voided', subjectId: 'ctr_abc', metadata: { reason } }
  And signers receive a courtesy email: "Contractul MSA 2026 a fost anulat de expeditor."
```

---

### Story F1.5 — Finalization — bake signatures into PDF + audit page

**As an** auditor (or company lawyer)
**I want** the final signed PDF to embed signature images + a tamper-evident audit page listing IPs, timestamps, hashes
**So that** I can prove who signed what, when, from where, without needing to query the DB

#### Scenario: Last signer completes — system bakes final PDF
```gherkin
Given signer #2 (radu) is the LAST signer; signer #1 (john) already SIGNED
When radu submits his signature via the same /s/<token> flow
Then after persisting signer #2 SIGNED, the service runs finalization (still in same tx, OR in a follow-up BullMQ job if PDF render exceeds 5s — design choice):
  1. Re-fetches base PDF from MinIO
  2. Validates pdfHashSha256 unchanged (defense against late tamper)
  3. Renders a NEW signed PDF: base PDF + appended pages with:
     - Per signer: name, role, email, signed-at timestamp (ISO + ro-RO localized), IP, UA, embedded signature PNG (scaled to 180×60 mm)
     - Audit summary page with: contract.id, base PDF SHA-256, signed PDF SHA-256, list of all ContractSignatureEvent rows
     - QR code linking to GET /api/v1/contracts/ctr_abc/audit (verifiable by anyone with the link AND auth)
  4. Uploads signed PDF to MinIO at "tenants/acme-ro/contracts/ctr_abc/signed.pdf"
  5. Computes signedPdfHashSha256 = sha256_hex(signedPdfBytes), persists on contract
  6. Sets contract.status='SIGNED', signedAt=now()
  7. ContractSignatureEvent { eventType: 'RESEALED', auditHash: sha256(signedPdfHash || allSignerIds || now()), payload: { signedPdfStorageKey } }
  8. Webhook 'CONTRACT_SIGNED' fires with payload { contractId, signedAt, signers: [...] } [propus enum]
  9. EmailService.sendTransactional to ALL signers + sender: "Contract finalizat — atașat PDF semnat" with the signed PDF as attachment (via presigned MinIO URL valid 24h)
And the contract is now visible at /app/contracts/ctr_abc with a "Descarcă PDF semnat" button that calls GET /api/v1/contracts/ctr_abc/signed-pdf → returns presigned MinIO GET URL valid 15 min
```

#### Scenario: Audit page accessible to authorized roles
```gherkin
Given ctr_abc is SIGNED with 2 signer events and 6 lifecycle events
When OWNER role user calls GET /api/v1/contracts/ctr_abc/audit
Then the response is 200 with body:
  {
    "contractId": "ctr_abc",
    "status": "SIGNED",
    "pdfHashSha256": "abc...",
    "signedPdfHashSha256": "def...",
    "ceremonyStartedAt": "...",
    "ceremonyExpiresAt": "...",
    "signers": [{ id, fullName, email, role, signOrder, status, signedAt, ipAddress, userAgent }],
    "events": [{ eventType, auditHash, ipAddress, userAgent, createdAt, payload }, ...]
  }
  And signatureImagePng is NOT included (use /signed-pdf for the full visual)

When MANAGER role user calls the same endpoint
Then the response is 403 { code: 'FORBIDDEN' } per D9 (only OWNER/ADMIN + createdById)

When the contract's createdById (radu, who is MANAGER) calls the endpoint
Then the response is 200 (ownership exception in D9)
```

#### Scenario: Signed PDF download — presigned URL with short TTL
```gherkin
Given john (counterparty, no Amass account) clicks the link in the finalization email
When john GETs https://files.amasscrm.ro/<presigned-key>?... (URL valid 24h from email)
Then MinIO serves the signed PDF directly
  And the PDF bytes match contract.signedPdfHashSha256 (immutable post-finalization)
  And after 24h, the URL returns 403 SignatureExpired (S3 presign semantics)
  And john has NO ongoing access to the CRM — the URL was a one-shot

Given radu (authed CRM user) wants to download
When radu calls GET /api/v1/contracts/ctr_abc/signed-pdf
Then the response is 302 to a freshly-minted presigned URL valid 15 min
  And subsequent calls each mint a fresh URL (no caching of presigned URLs server-side)
```

#### Scenario: Post-signature mutation blocked
```gherkin
Given ctr_abc.status='SIGNED'
When radu calls PATCH /api/v1/contracts/ctr_abc { value: 150000 }
Then the response is 409 { code: 'CONTRACT_IMMUTABLE', message: 'Signed contracts cannot be modified. Create a new contract or amendment.' }
  And the only allowed PATCH on SIGNED contracts: { status: 'TERMINATED', terminationReason: '...' } (Phase 3 amendment feature is out of scope)
  And DELETE is also blocked (status=SIGNED contracts are retained per D10 retention; admin must request a separate "anonymization" path under GDPR module)
```

---

### Story F1.6 — Cross-tenant isolation on signing endpoints

#### Scenario: Cross-tenant denied — Tenant B signer cannot sign Tenant A's contract
```gherkin
Given acme-ro has ctr_abc with signer token TOKEN_A for john@globex
  And globex has its own ctr_xyz with signer token TOKEN_X
When an attacker who knows TOKEN_A submits POST /api/v1/public/contracts/sign { token: TOKEN_A, ... }
Then the service hashes TOKEN_A, finds the matching ContractSigner row WITHOUT a tenant filter at the lookup step (public endpoint, unauthed) — BUT — the runWithTenant boundary uses the signer's tenantId (loaded from row)
  And ALL subsequent writes (signer update, event insert, contract status flip) happen INSIDE runWithTenant(signer.tenantId)
  And RLS GRANT enforces row writes only under correct tenantId at the DB layer
  And NO Tenant B data is accessible even if the public endpoint is the entry point
  And property-based test asserts: forall (tokenA in tenantA, tokenB in tenantB), submitting with tokenA never modifies any tenantB row
```

#### Scenario: Cross-tenant denied — admin cannot read another tenant's audit
```gherkin
Given globex admin calls GET /api/v1/contracts/<acme_ctr_id>/audit
Then the response is 404 { code: 'CONTRACT_NOT_FOUND' } [verificat: pattern from contracts.service.ts findOne]
  And NO existence leak, NO event rows visible
```

---

### Story F1.7 — eIDAS SES compliance hard requirements

**As a** product manager
**I want** the implementation to satisfy eIDAS SES (Simple Electronic Signature) baseline so the lawyer review can approve prod launch
**So that** we don't ship a feature that's legally unusable in EU contracts

#### Scenario: SES audit trail completeness checklist (per eIDAS Art. 25)
```gherkin
Given a fully signed contract ctr_abc
Then the audit (Story F1.5) MUST capture for EACH signer:
  - Identity link: email address + full name (declared) — sufficient for SES; AdES requires verified ID, OUT OF SCOPE (Q3)
  - Intent to sign: explicit "Sunt de acord" checkbox tick before canvas activation (NOT pre-checked) — payload field acceptedTerms=true required
  - Consent to electronic signing: same checkbox copy includes "Sunt de acord să semnez electronic acest document conform Reg. UE 910/2014 (eIDAS)"
  - Timestamp: signedAt to millisecond precision, server time UTC
  - Integrity link: signedPdfHashSha256 + per-event auditHash chain
  - Method record: { method: 'drawn_signature', deviceClass: 'web_browser', signaturePadVersion }
  And the lawyer-review block is enforced via env flag CONTRACT_ESIGN_ENABLED (Q3 decision): defaults to false in prod, true in staging
  And docs/ESIGN_COMPLIANCE.md is written documenting the SES capabilities + LIMITATIONS (not AdES, not QES) [propus]
```

#### Scenario: Sign-before-acceptedTerms is rejected
```gherkin
When signer submits POST /sign WITHOUT acceptedTerms=true in body
Then response 400 { code: 'TERMS_NOT_ACCEPTED', message: 'Acceptarea explicită este obligatorie.' }
  And NO signer state change, NO event row
```

---

### Non-functional F1

- **Coverage:** `contracts.service.ts` ≥80% line on new methods (send, preview-pdf, void, audit). New `contract-signing.service.ts` ≥85%. New `contract-pdf-renderer.ts` ≥90% (security-critical: template injection defense). New `signature-reminders.processor.ts` ≥80%. Total Phase 2 new code on contracts module: ≥80% per CLAUDE.md #8 critical-7 rule (contracts joins critical-7 by virtue of legal weight).
- **Multi-tenant isolation:** New E2E suite `apps/api/test/contracts.isolation.e2e.spec.ts` covers: cross-tenant read of contract, signer config, send-trigger, sign-attempt via stolen token, audit endpoint, presigned PDF URL request. Each must verify RLS at DB level via raw SQL probe (not just service-layer 404).
- **Property-based tests (fast-check):** State machine `(SignerStatus, ContractStatus)` transitions. Forall sequences of (notify/view/sign/decline/expire) actions, the final state matches a Markov chain reference table. Add `fast-check ^3` to devDeps `[propus]`. Specific properties: (1) signed_event_count_per_signer ≤ 1; (2) terminal states (SIGNED/DECLINED/EXPIRED) cannot transition out; (3) signOrder strictly enforced — signer N cannot sign while any signer in 1..N-1 is non-terminal.
- **Performance:**
  - PDF render p95 < 800ms for templates up to 20 pages
  - Token lookup at /s/<token> GET p95 < 50ms (single indexed query on `ceremonyTokenHash`)
  - Signature submit p99 < 2s (DB write + audit + email enqueue; PDF finalize deferred to BullMQ if total tx > 5s budget)
- **A11y (WCAG 2.1 AA):**
  - Canvas has visible focus ring + keyboard alternative ("Type your name" textbox renders cursive font as signature fallback)
  - Color-blind safe: status badges (DRAFT/OUT_FOR_SIGNATURE/SIGNED) use icon + label, not color alone
  - Screen-reader announces ceremony step ("Pas 1 din 3: Citește documentul")
  - `accessibility-auditor` sub-agent signs off
- **Security checklist:**
  - Token entropy: 32 bytes from `crypto.randomBytes` = 256 bit ≥ NIST minimum
  - Token storage: sha256(rawToken) in DB; raw NEVER persisted; revocation by status flip
  - PDF tamper: hash compare at every sign + at finalize
  - PNG smuggling: chunk allowlist + size cap + dimension cap
  - Email enumeration: ceremony GET returns same 404 for invalid-token vs valid-token-wrong-status
  - Rate limit: POST /sign throttled at 10 req/min per IP per token (defeats brute force on PNG validation)
  - `security-red-team` sub-agent reviews before merge
- **Audit log entries:** `contract.created`, `contract.preview.generated`, `contract.signer.added`, `contract.sent`, `contract.viewed_by_signer`, `contract.signed`, `contract.declined`, `contract.voided`, `contract.tamper_detected` (SECURITY-level), `contract.finalized`, `contract.signed_pdf_downloaded`
- **Prometheus counters:** `contract_sent_total{tenantId}`, `contract_signed_total{tenantId}`, `contract_declined_total{tenantId}`, `contract_voided_total{tenantId, reason}`, `contract_tamper_detected_total{tenantId}` (alert if > 0), `signature_pdf_render_duration_seconds` (histogram)
- **Webhook events added** `[propus]`: `CONTRACT_SENT_FOR_SIGNATURE`, `CONTRACT_SIGNED`, `CONTRACT_DECLINED`, `CONTRACT_VOIDED` (additive to Phase 1 enum)
- **GDPR retention (D10):** Cron `contracts.retention` runs weekly: contracts with status IN ('SIGNED','TERMINATED') older than tenant.contractRetentionYears (default 7) → flagged for GDPR review; signatures + IP/UA NOT auto-deleted (signed PDF is the legal record); reaches out via `/gdpr` module flow
- **Legal blocker (Q3):** `CONTRACT_ESIGN_ENABLED` env flag MUST be `false` in production until lawyer reviews `docs/ESIGN_COMPLIANCE.md` + DPIA addendum. Staging may run with flag `true`. Documented in RELEASE_CHECKLIST.md.

---

## Feature F2 — Approval workflows multi-step

**Effort:** 7 days (roadmap §2 P2). **Realistic adjusted:** 6-7 days (existing single-step skeleton + spec.ts saves the bootstrap).

### Schema additions `[propus]`

```prisma
enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
  EXPIRED     // NEW — SLA timer fired
  WITHDRAWN   // NEW — requester self-canceled
}

enum ApprovalSubjectType {
  QUOTE       // existing (back-compat)
  CONTRACT    // NEW — pre-signature approval gate
  DEAL_DISCOUNT  // NEW (placeholder for Phase 3; declared now to avoid future migration)
}

model ApprovalPolicy {
  // ... existing fields ...
  // NEW: ordered chain of approver groups (1 = first, 2 = second, ...)
  // Stored as Json array: [{ step: 1, approverIds: ['usr_alice'], slaHours: 24, name: 'Manager review' }, { step: 2, approverIds: ['usr_bob','usr_carol'], slaHours: 48, name: 'VP review' }]
  // Either approverIds[] (any-of) or approverRoleId for role-based
  // Total maximum: 5 steps to keep audit + UI tractable
  steps Json @default("[]")
  // applicable subjects (defaults to ['QUOTE'] for back-compat)
  applicableSubjects ApprovalSubjectType[] @default([QUOTE]) @map("applicable_subjects")
}

model ApprovalRequest {
  // ... existing fields ...
  // make quoteId nullable so we can polymorphic-subject
  quoteId   String?  @map("quote_id")  // CHANGED: was String, now String?
  subjectType ApprovalSubjectType @default(QUOTE) @map("subject_type")
  subjectId   String  @map("subject_id")  // generic FK (validated by subjectType)
  // SLA tracking — populated from policy.steps at request creation
  currentStep Int @default(1) @map("current_step")
  // when current step started (for SLA timer)
  currentStepStartedAt DateTime @default(now()) @map("current_step_started_at")
  // SLA deadline for the current step
  currentStepDeadline DateTime? @map("current_step_deadline")
  // Cached resolved approver IDs for the current step (denormalized from policy for query speed)
  currentStepApproverIds String[] @map("current_step_approver_ids")
  withdrawnAt DateTime? @map("withdrawn_at")
  withdrawReason String? @db.VarChar(500) @map("withdraw_reason")
  expiredAt DateTime? @map("expired_at")

  @@index([tenantId, subjectType, subjectId])
}

model ApprovalDecision {
  // ... existing fields ...
  // NEW: which step the decision applied to (for audit clarity in multi-step requests)
  step Int @default(1)
}

model ApprovalNotification {
  id          String   @id @default(cuid())
  tenantId    String   @map("tenant_id")
  requestId   String   @map("request_id")
  step        Int
  approverId  String   @map("approver_id")
  // EMAIL | IN_APP | BOTH
  channel     String   @db.VarChar(10)
  // SENT | DELIVERED | FAILED
  status      String   @db.VarChar(10)
  errorMessage String? @map("error_message")
  sentAt      DateTime @default(now()) @map("sent_at")

  request ApprovalRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@index([tenantId, requestId, step])
  @@map("approval_notifications")
}
```

Migration plan:
- `2026XXXX_phase2_approvals_multistep.sql` — additive: enum value adds (`EXPIRED`, `WITHDRAWN` on `ApprovalStatus`), new enum (`ApprovalSubjectType`), new columns on `ApprovalPolicy` + `ApprovalRequest` + `ApprovalDecision`, new table `approval_notifications`. Backfill: existing rows get `subjectType='QUOTE'`, `subjectId=quoteId`, `currentStep=1`, `applicableSubjects=['QUOTE']`, `steps=[{step:1, approverIds:[<policy.approverId or []>], slaHours:null}]`. Drop `quoteId` NOT NULL constraint.

---

### Story F2.1 — Admin defines a multi-step policy

**As an** admin `admin@acme.ro` (role ADMIN)
**I want** to configure a 2-step approval policy: "Quotes > 50k RON require Manager then VP"
**So that** I enforce escalation without manual coordination

#### Scenario: Create 2-step policy (happy path)
```gherkin
Given admin is on /app/settings/approval-policies
When admin submits POST /api/v1/approvals/policies {
    name: 'Quote escalation > 50k RON',
    trigger: 'QUOTE_ABOVE_VALUE',
    config: { threshold: 50000, currency: 'RON' },
    applicableSubjects: ['QUOTE'],
    steps: [
      { step: 1, approverIds: ['usr_manager_dan'], slaHours: 24, name: 'Manager review' },
      { step: 2, approverIds: ['usr_vp_elena','usr_vp_florin'], slaHours: 48, name: 'VP review (any-of)' }
    ],
    isActive: true
  }
Then the response is 201 with the created policy
  And steps Json is validated (Zod): each step.step is 1-5, monotonically increasing starting from 1, no gaps; approverIds non-empty; slaHours optional int 1-168
  And approver user IDs are validated: all exist in users table for this tenant (cross-tenant approverIds → 400 INVALID_APPROVER)
  And audit log: { action: 'approval_policy.created', subjectId: 'pol_abc', metadata: { steps: 2, trigger } }
```

#### Scenario: Policy step approverIds cross-tenant rejected
```gherkin
When admin submits steps with approverIds: ['usr_alice_from_globex']
Then the response is 400 { code: 'INVALID_APPROVER', details: { invalidIds: ['usr_alice_from_globex'] } }
  And the existence check is done inside runWithTenant(acme-ro) so it cannot leak whether the ID exists in globex
```

#### Scenario: Step count cap enforced
```gherkin
When admin submits 6 steps
Then the response is 400 { code: 'TOO_MANY_STEPS', message: 'Max 5 steps per policy' }
```

---

### Story F2.2 — Quote send triggers multi-step request with first-step notification

**As a** sales rep
**I want** to send a quote and have the system route it through Manager → VP automatically
**So that** I don't have to remember the escalation matrix

#### Scenario: Quote with value 75k triggers 2-step request
```gherkin
Given policy 'Quote escalation > 50k RON' is active with 2 steps as above
  And quote qte_xyz has value=75000, currency=RON, status=DRAFT
When sales rep calls POST /api/v1/quotes/qte_xyz/send
Then ApprovalsService.checkAndRequestApproval matches the QUOTE_ABOVE_VALUE policy
  And creates ApprovalRequest {
    id: 'req_abc', policyId: 'pol_abc', subjectType: 'QUOTE', subjectId: 'qte_xyz', quoteId: 'qte_xyz' (back-compat populated),
    requestedBy: rep.id, status: 'PENDING',
    currentStep: 1, currentStepStartedAt: now(), currentStepDeadline: now()+24h, currentStepApproverIds: ['usr_manager_dan']
  }
  And the quote stays in status DRAFT (or transitions to PENDING_APPROVAL — check existing behavior; phase-2 spec preserves current pattern: SENT only after final approval)
  And one ApprovalNotification row inserted: { step: 1, approverId: 'usr_manager_dan', channel: 'BOTH', status: 'SENT' }
  And Email queued to usr_manager_dan: "Aprobare cerută — Quote QTE-2026-042" with deep link /app/approvals/req_abc
  And Socket.IO in-app notification fired to usr_manager_dan: { type: 'approval.requested', requestId: 'req_abc' }
  And NO notification yet to usr_vp_elena / usr_vp_florin (they're step 2)
```

#### Scenario: Same quote against multiple matching policies
```gherkin
Given two active policies match the same quote
When the quote is sent
Then ONE ApprovalRequest per policy (current behavior preserved via skipDuplicates) [verificat: approvals.service.ts:103]
  And the quote needs APPROVAL from ALL such requests' final steps before transitioning to SENT
  And UI shows both requests on the quote's "Aprobări" tab
```

---

### Story F2.3 — Approver decides, request progresses or finalizes

**As an** approver
**I want** to approve or reject from my inbox; progress moves to the next step on approve, rejects close immediately
**So that** the chain is auditable + transparent

#### Scenario: Step 1 approval advances to step 2
```gherkin
Given req_abc is PENDING at step 1, currentStepApproverIds=['usr_manager_dan']
When usr_manager_dan calls POST /api/v1/approvals/requests/req_abc/decide { status: 'APPROVED', comment: 'Looks good, escalating to VP.' }
Then the service runs in tx:
  1. SELECT ApprovalRequest FOR UPDATE — guards against double-decide race
  2. Assert request.status='PENDING' AND request.currentStep=1 AND usr_manager_dan IN request.currentStepApproverIds → else 409
  3. Insert ApprovalDecision { requestId, step: 1, deciderId: 'usr_manager_dan', status: 'APPROVED', comment }
  4. Lookup policy.steps to find step 2: { approverIds: ['usr_vp_elena','usr_vp_florin'], slaHours: 48 }
  5. Update ApprovalRequest: currentStep=2, currentStepStartedAt=now(), currentStepDeadline=now()+48h, currentStepApproverIds=['usr_vp_elena','usr_vp_florin']
  6. Status REMAINS 'PENDING' (chain not finished)
  7. Insert 2 ApprovalNotification rows for step 2 approvers
  8. Email + in-app to both VPs (any-of: first to act wins)
  9. NO quote status change yet
And response 200 { message: 'Approved at step 1; advanced to step 2 (VP review).' }
```

#### Scenario: Final step approval transitions quote to SENT
```gherkin
Given req_abc has currentStep=2, currentStepApproverIds=['usr_vp_elena','usr_vp_florin']
When usr_vp_elena calls POST /api/v1/approvals/requests/req_abc/decide { status: 'APPROVED' }
Then ApprovalDecision { step: 2, deciderId: 'elena', status: 'APPROVED' }
  And policy.steps has NO step 3
  And request.status='APPROVED' (terminal)
  And ALL ApprovalRequests for the same quoteId/subjectId checked — if ALL are APPROVED (across multiple policies), quote.status='SENT' (matches current logic in approvals.service.ts:163-169 extended to handle subjectType)
  And webhook 'APPROVAL_DECIDED' fires (existing enum) with payload { requestId, finalStatus: 'APPROVED', steps: 2, subjectType: 'QUOTE', subjectId: 'qte_xyz' }
  And in-app + email notification to the requestedBy user: "Quote QTE-2026-042 a fost aprobat și trimis."
```

#### Scenario: Rejection at any step terminates chain
```gherkin
Given req_abc at step 1
When usr_manager_dan calls /decide { status: 'REJECTED', comment: 'Discount too aggressive.' }
Then ApprovalDecision { step: 1, status: 'REJECTED' }
  And request.status='REJECTED' (terminal, even if 5 more steps existed)
  And quote.status reverts to 'DRAFT' (matches current behavior, approvals.service.ts:166-167)
  And step 2 approvers receive NO notification (chain dead)
  And requestedBy receives: "Quote QTE-2026-042 respins de Dan: 'Discount too aggressive.'"
```

#### Scenario: Wrong-step approver attempts to decide
```gherkin
Given req_abc.currentStep=1, currentStepApproverIds=['usr_manager_dan']
When usr_vp_elena (a step 2 approver) calls /decide
Then response 403 { code: 'NOT_CURRENT_STEP_APPROVER', message: 'You are not authorized to decide at the current step.' }
  And NO decision row created
  And NO state change
```

#### Scenario: Already-decided request cannot be re-decided
```gherkin
Given req_abc.status='APPROVED' (terminal)
When ANY approver calls /decide
Then response 409 { code: 'REQUEST_NOT_PENDING' } [verificat: existing pattern approvals.service.ts:140]
```

#### Scenario: Race — two approvers click APPROVE within milliseconds (step 2 any-of)
```gherkin
Given req_abc.currentStep=2, currentStepApproverIds=['usr_vp_elena','usr_vp_florin']
When elena AND florin both POST /decide concurrently
Then ONE submission acquires SELECT FOR UPDATE → updates request to APPROVED
  And the SECOND sees status='APPROVED' on its FOR UPDATE → returns 409 REQUEST_NOT_PENDING
  And EXACTLY ONE ApprovalDecision row for step 2 (the winner)
  And EXACTLY ONE quote.status='SENT' transition
  And property-based test (fast-check) asserts: forall race orderings of N approvers at the same step, decided_count = 1
```

---

### Story F2.4 — SLA timer auto-expiry

**As an** admin
**I want** stale requests to auto-expire so they don't block the pipeline forever
**So that** sales reps know to escalate manually or revise the deal

#### Scenario: Step SLA expires — request → EXPIRED, requester notified
```gherkin
Given req_abc.currentStep=1, currentStepDeadline='2026-05-19T10:00:00Z'
  And current time is '2026-05-19T10:00:01Z' and no decision was made
  And BullMQ cron 'approval-sla' runs every 15 minutes
When the cron tick fires
Then the cron finds requests WHERE status='PENDING' AND currentStepDeadline < now()
  And for each: request.status='EXPIRED', request.expiredAt=now()
  And ApprovalDecision { step: <current>, deciderId: 'system', status: 'EXPIRED', comment: 'Auto-expired: SLA <Xh> exceeded' } (use 'system' as a reserved deciderId, NOT NULL)
  And webhook APPROVAL_DECIDED fires with finalStatus='EXPIRED'
  And requestedBy gets email + in-app: "Approval request expired at step 1 — Manager review. Resubmit or contact admin."
  And the subject (quote) does NOT auto-transition to SENT (EXPIRED ≠ APPROVED); stays in current state
  And approverIds at the expired step also get in-app notification (FYI): "Request you didn't act on expired."
```

#### Scenario: Decision lands AFTER deadline — accepted but flagged late
```gherkin
Given req_abc.currentStepDeadline='2026-05-19T10:00:00Z'
  And at '2026-05-19T10:00:00.500Z' (500ms past deadline) the cron hasn't yet run
  And usr_manager_dan submits /decide { status: 'APPROVED' }
Then the decision is ACCEPTED (race window before cron) — pragmatic, avoids angry approvers whose click "lost" to the cron
  And ApprovalDecision row includes flag late=true (new field) AND payload metadata { deadlineWas, decidedAt, lateBy: '500ms' }
  And from the user POV, the chain proceeds normally
  And reporting flags: "X% of approvals decided late this month" — visible in admin dashboard
```

---

### Story F2.5 — Requester withdraws request

**As a** sales rep
**I want** to withdraw my own request if I realize the quote needs changes
**So that** I don't waste approver time and avoid an EXPIRED audit blemish

#### Scenario: Requester withdraws PENDING request
```gherkin
Given req_abc.status='PENDING', requestedBy=rep.id
When rep calls POST /api/v1/approvals/requests/req_abc/withdraw { reason: 'Renegociating discount with customer.' }
Then request.status='WITHDRAWN', withdrawnAt=now(), withdrawReason=<sanitized>
  And ApprovalDecision { step: <current>, deciderId: rep.id, status: 'WITHDRAWN', comment: reason }
  And ALL currentStepApproverIds get in-app notification: "Request withdrawn by requester — no action needed."
  And the quote stays DRAFT (no SENT transition)
  And audit log: { action: 'approval_request.withdrawn', subjectId: 'req_abc', metadata: { step, reason } }
```

#### Scenario: Non-requester cannot withdraw
```gherkin
When a different user (not the requestedBy) calls /withdraw on req_abc
Then response 403 { code: 'NOT_REQUESTER', message: 'Only the requester can withdraw a request.' }
  And ADMIN can override via /cancel (admin-only endpoint, different audit action) — existing CANCELLED status
```

---

### Story F2.6 — In-app approval inbox

**As an** approver
**I want** a real-time inbox of pending requests addressed to me
**So that** I act fast and don't miss SLA windows

#### Scenario: Inbox lists my pending requests across all subject types
```gherkin
Given usr_vp_elena has 3 PENDING requests at step where she's in currentStepApproverIds
When elena GETs /api/v1/approvals/my-inbox
Then response 200 with array of 3 items: [{ requestId, subjectType: 'QUOTE'|'CONTRACT'|..., subjectSummary: 'QTE-2026-042 — Globex Q3 — 75.000 RON', currentStep, slaRemainingHours, requestedBy: { id, fullName }, requestedAt }, ...]
  And the query uses an index on (tenantId, status, currentStepApproverIds @> [userId])
  And p95 < 200ms even for tenants with 10k historical requests
  And the response is owner-scoped: elena sees ONLY requests where she's listed at the current step, not historical ones where she already decided
```

#### Scenario: Real-time push when new request lands in inbox
```gherkin
Given elena has an open browser session at /app/approvals
When a new request advances to a step where she's an approver
Then Socket.IO emits to elena's session: { type: 'approval.requested', requestId, urgent: <slaRemaining<6h> }
  And the inbox badge in the global nav increments
  And the inbox auto-prepends the new item without a manual refresh
```

#### Scenario: Inbox cross-tenant isolation
```gherkin
Given elena is in tenant acme-ro
  And globex has 5 pending requests addressed to a user with same email (orphan account)
When elena GETs /my-inbox
Then she sees only acme-ro requests
  And the query runs inside runWithTenant(acme-ro)
  And no globex data leaks
```

---

### Story F2.7 — Subject-type extension to Contract (e-sign gating)

**As a** sales manager
**I want** contracts above 100k RON to require my approval before the rep can send for signature
**So that** high-value commitments don't go out without oversight

#### Scenario: Contract send blocked until approval
```gherkin
Given policy active: { trigger: 'CONTRACT_ABOVE_VALUE' (new trigger), config: { threshold: 100000, currency: 'RON' }, steps: [{ step:1, approverIds: ['usr_manager_dan'] }], applicableSubjects: ['CONTRACT'] }
  And contract ctr_big has value=150000 RON, status=DRAFT
When sales rep calls POST /api/v1/contracts/ctr_big/send (the F1.2 endpoint)
Then ApprovalsService.checkAndRequestApproval is called BEFORE PDF lock / status transition
  And finds matching policy → creates ApprovalRequest { subjectType: 'CONTRACT', subjectId: 'ctr_big' }
  And ContractsService.send returns 202 ACCEPTED { message: 'Contract pending approval at step 1', requestId: 'req_xyz', contractStatus: 'DRAFT' }
  And NO PDF lock, NO ceremony, NO signer notifications yet
  And usr_manager_dan receives the approval notification
```

#### Scenario: Contract send resumes after approval
```gherkin
Given req_xyz reached APPROVED (final step)
When the system finalizes the approval (Story F2.3 finalization path)
Then a new BullMQ job 'contract.send-after-approval' fires
  And ContractsService.send actually runs (PDF lock + signer email per F1.2)
  And contract.status='OUT_FOR_SIGNATURE'
  And requestedBy (the sales rep) gets in-app + email: "Contract ctr_big approved. Ceremony started."
```

#### Scenario: Contract send blocked by approval rejection
```gherkin
Given req_xyz is REJECTED
Then contract.status stays DRAFT
  And rep notified: "Contract not approved. Revise and resubmit."
  And NO ceremony, NO PDF lock
```

#### Scenario: New trigger `CONTRACT_ABOVE_VALUE` validation
```gherkin
Given admin creates a policy with trigger='CONTRACT_ABOVE_VALUE' and config={ threshold: 100000, currency: 'RON' }
Then Zod validates config schema per trigger:
  - CONTRACT_ABOVE_VALUE requires { threshold: positive number, currency: ISO 4217 enum }
  - QUOTE_ABOVE_VALUE: same shape
  - DISCOUNT_ABOVE_PCT: { pct: number 0-100 }
  And the trigger enum gets the new value in migration [propus]
```

---

### Non-functional F2

- **Coverage:** `approvals.service.ts` ≥85% (raises from current single-step baseline; existing spec preserved + extended). New `approvals-sla.processor.ts` ≥80%. New `approvals-notification.service.ts` ≥80%. Total approvals module: ≥80% per CLAUDE.md #8.
- **Property-based testing (`fast-check`):** State machine + chain progression invariants. Specific properties:
  1. **Linearity:** forall sequences of (approve, reject, withdraw, expire) events on N-step chain, final state ∈ {APPROVED, REJECTED, EXPIRED, WITHDRAWN, CANCELLED} — no orphan PENDING after terminal action.
  2. **Step monotonicity:** currentStep never decreases.
  3. **Decision-count cap:** count(ApprovalDecision WHERE requestId=R AND deciderId NOT IN ('system')) ≤ count of completed steps.
  4. **Race safety:** forall N concurrent decisions at same step, exactly 1 advances state, N-1 return 409.
  5. **SLA correctness:** if EXPIRED at time T, no human decision exists at WHERE decidedAt > deadline (with the 500ms grace from Story F2.4).
- **Multi-tenant isolation E2E:** New `apps/api/test/approvals.isolation.e2e.spec.ts` covers cross-tenant policy read, request read, decide attempt, inbox query, notification dispatch (no cross-tenant email recipient).
- **Performance:**
  - `/decide` p95 < 250ms (single tx with FOR UPDATE + notification enqueue)
  - `/my-inbox` p95 < 200ms for 10k historical requests in tenant (GIN index on `current_step_approver_ids`)
  - SLA cron sweep p95 < 5s for 10k PENDING requests
- **A11y:**
  - Inbox keyboard-navigable (tab through items, Enter to open detail, A to approve from list, R to reject)
  - Status badges use icon + text + color
  - SLA countdown rendered as time element with `datetime=ISO` attribute
- **Audit log:** `approval_policy.{created,updated,deleted}`, `approval_request.{created,decided,withdrawn,expired,cancelled}`, `approval_notification.sent`, `approval_chain.advanced`
- **Prometheus counters:** `approval_requests_created_total{tenantId, subjectType}`, `approval_decisions_total{tenantId, status, step}`, `approval_expirations_total{tenantId}`, `approval_late_decisions_total{tenantId}`, `approval_request_duration_seconds` (histogram from created → final)
- **Notification fan-out** (per CLAUDE.md #14 async propagation): notification failures (email bounce, Socket.IO disconnect) MUST NOT block the /decide transaction. Record `ApprovalNotification.status='FAILED'` + `errorMessage`, surface in admin dashboard, retry via BullMQ with same backoff as Phase 1 webhooks (30s, 5min, 30min, 2h, 6h).

---

## Feature F3 — Polish + bug bash + regression (1 week)

**Effort:** 5 working days. Owner: `qa-manual` lead, supported by `ux-designer` + `code-reviewer` + `accessibility-auditor`.

### F3.1 — Manual regression on golden paths (Phase 0 + 1 + 2)

**As a** PM
**I want** a checklist-driven manual pass covering every shipped feature on staging
**So that** Phase 2 doesn't quietly regress Phase 0/1 work

#### Scenario: Run golden-path script on staging tenant `staging-acme`
```gherkin
Given staging has a fresh tenant 'staging-acme' with 5 seed users, 50 companies, 100 contacts, 30 deals
  And qa-manual loads docs/QA_GOLDEN_PATHS.md [propus — new doc this sprint]
When qa-manual executes the 18-step golden-path script:
  PHASE 0:
    1. Login → switch UI to English → reload, verify English persists [Story phase-0 F1.1]
    2. Create deal in EUR, verify amountBase computed in RON [Story phase-0 F2.1]
    3. Save a custom view on /deals, refresh, verify persistence [Story phase-0 F3.1]
  PHASE 1:
    4. Create campaign, build template via drag-drop, send-test to self [Story phase-1 F2.1-2.2]
    5. Open the test email, verify tracking pixel registers in /campaigns/:id/stats [Story phase-1 F1.1, F1.2]
    6. Click link in email, verify click count [Story phase-1 F1.1]
    7. Trigger unsubscribe via footer link, verify suppression [Story phase-1 F1.1]
    8. Create webhook endpoint to https://webhook.site/<uuid>, trigger DEAL_CREATED, verify HMAC [Story phase-1 F3.1-3.2]
    9. Replay a failed delivery from /deliveries panel [Story phase-1 F3.3]
  PHASE 2 NEW:
    10. Create contract from template, add 2 signers, preview PDF [Story F1.1]
    11. Send for signature, sign as counterparty in incognito, sign as tenant rep [F1.2, F1.3]
    12. Download signed PDF, verify embedded signature images + audit page [F1.5]
    13. Attempt tamper: modify base PDF in MinIO via admin script, attempt sign → expect VOIDED [F1.3]
    14. Create approval policy (2 steps), trigger via 75k quote send [F2.1, F2.2]
    15. Approve at step 1, then approve at step 2, verify quote → SENT [F2.3]
    16. Withdraw a PENDING request as requester [F2.5]
    17. Let an SLA expire (set deadline to past via DB), trigger cron, verify EXPIRED state [F2.4]
    18. Check /app/approvals/my-inbox shows real-time updates via Socket.IO [F2.6]
Then each step is checked off with screenshot evidence in docs/QA_PHASE2_RUN_<date>.md [propus]
  And any failure spawns a bug ticket with severity (P0 blocks release, P1 ships with workaround, P2 deferred to Phase 2.1.1)
  And the doc QA_GOLDEN_PATHS.md becomes living: future phases add more steps
```

#### Scenario: Regression on previous-phase critical paths
```gherkin
Given Phase 0 and Phase 1 critical paths are documented in their respective spec files
When qa-manual runs the full regression
Then BLOCKERS (P0) for previously-shipped features prevent Phase 2 release until fixed
  And bug fixes for Phase 2-introduced regressions land in fix(<module>) commits, NOT separate PRs (atomic with the bug bash)
  And the final regression run results are appended to docs/QA_PHASE2_RUN_<date>.md
```

---

### F3.2 — Address 7 Phase 1.1.1 deferred items (best-effort)

**Priority order** (per ROADMAP_V2 risk register + CHANGELOG line 12-18):
1. **CRIT-1 full** — `TenantSendingDomain` model + DKIM verify + `fromAddress` whitelist (~2 days; biggest, most risk-reducing)
2. **HIGH-4** — Per-event Zod payload schemas for webhook events (~0.5 day; defensive type safety)
3. **T-MAIL-T-03** — HTML body sanitizer (cheerio/DOMPurify) for `injectTracking` (~0.5 day)
4. **T-MAIL-D-01** — `@Throttle` decorator on `/e/t/*` tracking endpoints (~0.25 day)
5. **MED-4 + MEDIUM-1** — Outbox retention cron + suspended-tenant outbox cleanup (~0.5 day combined)
6. **I-2** — Wire `CampaignRecipientsService.recordEvent` from `EmailTrackingService.recordOpen/Click` (~0.25 day)
7. **I-3** — `EmailService.sendTransactional` calls `injectTracking` (~0.25 day)

**Total estimated:** ~4.25 dev-days. Stop at the end of day 3 if Phase 2 main features still have bugs from F3.1. Defer remaining to Phase 2.1.1.

#### Scenario: CRIT-1 full — TenantSendingDomain model + DKIM verify
```gherkin
Given Phase 1.1 deferred this with the partial fix being "send-test recipient must be active+verified User"
When phase 2 polish lands TenantSendingDomain
Then a new model exists:
  model TenantSendingDomain {
    id String @id @default(cuid())
    tenantId String
    domain String  // e.g. 'acme.ro'
    dkimSelector String?
    dkimPublicKey String? @db.Text
    verifiedAt DateTime?
    verificationToken String  // for DNS TXT challenge
    @@unique([tenantId, domain])
  }
  And admin endpoint POST /api/v1/email/sending-domains creates a row + returns verification instructions
  And periodic cron verifies via DNS TXT lookup of '_amass-verify.<domain>'
  And `CampaignsService.sendTest` + production send paths assert: `EmailAccount.fromAddress.domain` ∈ verified TenantSendingDomain.domain for the tenant
  And reject 400 SENDER_DOMAIN_NOT_VERIFIED otherwise
  And migration is additive: existing EmailAccounts grandfathered for 30 days with feature flag
```

#### Scenario: HIGH-4 — Per-event Zod schemas for webhook payloads
```gherkin
Given webhook payloads today are typed loosely as `Json`
When the refactor lands
Then each WebhookEvent enum value has a corresponding Zod schema in @amass/shared:
  - DEAL_CREATED → DealCreatedPayloadSchema
  - EMAIL_OPENED → EmailOpenedPayloadSchema
  - CONTRACT_SIGNED → ContractSignedPayloadSchema (new from Phase 2)
  - ... all 14 events
  And WebhookDeliveryProcessor.process validates payload AGAINST the schema before dispatch — schema mismatch → DLQ + Sentry alert
  And docs/WEBHOOKS_INTEGRATION.md publishes the schemas as JSON Schema for receivers
```

#### Scenarios for T-MAIL-T-03, T-MAIL-D-01, MED-4, I-2, I-3: per their original tickets in SECURITY_FINDINGS.md (linked, not re-spec'd here to avoid duplication)

---

### F3.3 — UX polish on new UIs (signature canvas + approval inbox)

**As a** UX-conscious PM
**I want** the new UIs to feel native, not engineered
**So that** users adopt without training

#### Scenario: Signature canvas polish pass
```gherkin
Given the signature canvas page is functionally complete (F1.3)
When ux-designer audits with users on touch + mouse + stylus
Then the following polish items are addressed:
  - Pen width: 2.5px default; thicker/thinner toggle for accessibility
  - "Curăță" button clears the canvas with confirm
  - Visual indicator while drawing (cursor crosshair on desktop, no cursor on mobile)
  - "Tastează numele" alternative: cursive font preview, generates a PNG server-side from text
  - Mobile: portrait + landscape both work; canvas scales to viewport width with maintained aspect ratio
  - "Sunt de acord" checkbox MUST be ticked to enable Sign button (visual disabled state)
  - Loading state on submit (button spinner, prevents double-tap submit)
  - Success state: smooth transition to "Mulțumim — vei primi un email cu contractul semnat în ~2 minute"
  - Error states: tamper / network failure messages in Romanian, with retry button where appropriate
And accessibility-auditor verifies WCAG 2.1 AA on this page specifically
```

#### Scenario: Approval inbox polish pass
```gherkin
Given /app/approvals/my-inbox is functionally complete (F2.6)
When ux-designer audits
Then the following polish items are addressed:
  - Empty state illustration: "Inbox-ul tău e gol. Bună treabă!" with subtle dial graphic
  - List density: comfortable (default) vs compact toggle
  - SLA countdown: green > 24h, amber 6-24h, red < 6h; uses time element + tooltip for full timestamp
  - Bulk actions: select multiple → bulk approve (with confirmation modal showing list of subjects)
  - Filter chips: by subject type (Quote/Contract), by SLA urgency, by requester
  - Real-time toast on new item: bottom-right, dismissible, sound optional in user settings
  - Detail panel slides in from the right (does NOT navigate away — preserve inbox context)
  - Decision flow inline: comment textarea inline, Approve/Reject buttons primary/secondary
  - Confirmation on Reject (require comment ≥ 10 chars to discourage rage-clicks)
And ux-designer signs off via screenshot review
```

---

### Non-functional F3

- **Bug bash deliverable:** `docs/QA_PHASE2_RUN_<date>.md` with screenshots + bug ticket links
- **Defect classification (per RELEASE_CHECKLIST style):**
  - P0 (blocker): security regression, data loss, multi-tenant leak, signed-contract corruption, approval state-machine cycle → BLOCK release until fixed
  - P1 (high): UX regressions on golden paths, perf regression > 50% on critical endpoints → ship with workaround documented
  - P2 (medium): minor UX nits, edge-case errors with reasonable error messages → defer to Phase 2.1.1
  - P3 (low): cosmetic, typo, copy → batch into next sprint
- **Performance budget verification:**
  - PDF render p95 < 800ms (F1.1)
  - Token lookup p95 < 50ms (F1.2)
  - Decide p95 < 250ms (F2.3)
  - Inbox p95 < 200ms (F2.6)
  - Run via `pnpm benchmark` on staging; results pasted into the QA doc
- **Test count target:** Phase 2 adds an estimated ~180-220 unit tests + ~12-15 E2E specs. Total target: **1850+ unit tests passing** by Phase 2 close (vs. 1665 at Phase 1 close per CHANGELOG line 9).

---

## Non-functional acceptance — cross-cutting Phase 2

### Coverage (CLAUDE.md #8)

Phase 2 ELEVATES `contracts` and `approvals` to the critical-7 list (they handle legal commitments + financial gates). Minimum ≥80% line on:
- `contracts.service.ts`, `contract-signing.service.ts`, `contract-pdf-renderer.ts`, `signature-reminders.processor.ts`
- `approvals.service.ts`, `approvals-sla.processor.ts`, `approvals-notification.service.ts`

Run before any PR merge:
```
pnpm --filter @amass/api vitest run --config vitest.config.unit.ts --coverage \
  --reporter=verbose \
  apps/api/src/modules/{contracts,approvals}/
```

### Multi-tenant isolation (CLAUDE.md #3)

E2E tests required (all under `apps/api/test/`):
- `contracts.isolation.e2e.spec.ts` — cross-tenant CRUD, send, sign-attempt via stolen token, audit, signed-PDF download
- `approvals.isolation.e2e.spec.ts` — cross-tenant policy CRUD, request CRUD, decide, inbox, notification dispatch
- `contracts.race.e2e.spec.ts` — property-based: concurrent signs, concurrent decides, signOrder enforcement
- `approvals.race.e2e.spec.ts` — property-based: chain progression invariants

Each MUST use `runWithTenant` boundaries AND verify RLS at the DB level.

### Security (CLAUDE.md #3 + `docs/SCALING.md` + OWASP top-10 + eIDAS SES)

`security-red-team` reviews:
- Signature token entropy + storage (hash-only) + revocation by status flip
- PDF tamper-evident hash compare at sign + finalize
- PNG payload smuggling defense (chunk allowlist, dimension cap, byte cap)
- Public endpoint enumeration: identical 404 for invalid-token vs valid-but-wrong-status
- Rate limit on POST /sign per token + per IP
- Approval state machine: race safety via SELECT FOR UPDATE
- Cross-tenant approver assignment validation
- Email + Socket.IO notification failures NEVER block decide transaction (graceful degradation)

### A11y (WCAG 2.1 AA)

- Signature canvas: keyboard-alternative ("type name → cursive PNG"), focus ring on canvas, ARIA live region for status
- Approval inbox: keyboard-navigable list (j/k or arrows), bulk-select with Shift+Click, SLA countdown as time element
- Contract template editor: textarea with monospace font; preview pane sandboxed iframe with sandbox="allow-same-origin"
- `accessibility-auditor` signs off in PR before merge

### Performance budgets

- Token lookup: p95 < 50ms
- PDF render: p95 < 800ms (20-page template); finalize (with audit page) p95 < 1500ms
- Signature submit (full flow incl. tamper check, DB writes, audit, email enqueue): p99 < 2s
- Approval decide: p95 < 250ms
- Approval inbox: p95 < 200ms for tenants with 10k historical requests
- SLA cron sweep: p95 < 5s for 10k PENDING

### Observability

New counters / gauges (existing Prometheus registry):
- `contract_sent_total{tenantId}`, `contract_signed_total{tenantId}`, `contract_declined_total{tenantId}`, `contract_voided_total{tenantId, reason}`, `contract_tamper_detected_total{tenantId}` (alert if > 0)
- `signature_pdf_render_duration_seconds` (histogram, buckets 0.1/0.5/1/2/5s)
- `approval_requests_created_total{tenantId, subjectType}`, `approval_decisions_total{tenantId, status, step}`, `approval_expirations_total{tenantId}`, `approval_late_decisions_total{tenantId}`
- `approval_request_duration_seconds` (histogram from created → final, buckets 1m/10m/1h/6h/24h/72h)

### Audit log entries (append-only)

Per `docs/SCALING.md` audit pattern:
- F1: `contract.created`, `contract.preview.generated`, `contract.signer.added`, `contract.sent`, `contract.viewed_by_signer`, `contract.signed`, `contract.declined`, `contract.voided`, `contract.tamper_detected` (SECURITY-level), `contract.finalized`, `contract.signed_pdf_downloaded`
- F2: `approval_policy.{created,updated,deleted}`, `approval_request.{created,decided,withdrawn,expired,cancelled}`, `approval_notification.sent`, `approval_chain.advanced`

### Definition of Done per feature (per CLAUDE.md #2)

1. Lint pass: `pnpm lint`
2. Unit + integration + property-based tests pass: `pnpm --filter @amass/api vitest run`
3. Coverage clears 80% on new service code (85% on `contract-signing.service.ts`, 90% on `contract-pdf-renderer.ts`)
4. E2E smoke on staging including cross-tenant + race-property tests
5. `code-reviewer` approves
6. `security-red-team` approves (signing + PDF + state-machine + cross-tenant checklist)
7. `accessibility-auditor` approves signing canvas + approval inbox
8. `docs/FEATURES.md` updated with Phase 2 entries
9. `docs/ESIGN_COMPLIANCE.md` written (SES capabilities + limitations) `[propus]`
10. `docs/QA_GOLDEN_PATHS.md` written `[propus]`
11. CHANGELOG entry written
12. RELEASE_CHECKLIST.md updated: `CONTRACT_ESIGN_ENABLED=false` in prod env until lawyer sign-off (Q3)
13. Conventional commits landed on `main`

---

## RICE prioritization within Phase 2

| Feature | Reach (users/Q) | Impact | Confidence | Effort (weeks) | RICE |
|---|---|---|---|---|---|
| **F1 — E-sign on contracts** | 60 (every sales user closing deals) | 3 (massive — eliminates DocuSign $0.10/envelope + the entire print-scan friction) | 70% (in-house signing is novel; legal block on prod) | 1.5 | **84** |
| **F2 — Approval workflows multi-step** | 25 (managers + VPs at tenants with >5 sales reps) | 2 (high — enables enterprise sales motion) | 80% (skeleton exists, mostly extension work) | 1.4 | **29** |
| **F3 — Polish + bug bash** | 100 (all users benefit from less buggy CRM) | 2 (high — regression-free release = trust) | 95% (we know how to run QA) | 1.0 | **190** |

**Recommended sequence within Phase 2:**
1. **F2 ships first** (week 1) — extends existing skeleton, low novelty risk, unblocks F1's contract-approval gate (F1 Story 2.7 depends on F2 multi-step working).
2. **F1 ships second** (week 2) — biggest novel build (PDF + signing flow), legal block doesn't gate code merge, only prod flag flip.
3. **F3 happens last** (week 3) — must follow F1+F2 to regress them, plus addresses 7 Phase 1.1.1 deferrals.

Parallel work:
- BE work on F1 schema + signing service can happen alongside FE work on F2 inbox
- `security-red-team` reviews F1 in parallel with F3 manual regression
- `accessibility-auditor` reviews F1 canvas + F2 inbox in same audit pass

---

## Out of scope — DO NOT build in Phase 2

- **DocuSign API integration** — Phase 3 candidate if customers explicitly request after F1 SES launch
- **AdES / QES signatures** (Advanced / Qualified Electronic Signature) — requires verified ID provider (e.g. iDIN, BankID, SPID); Phase 5+
- **Bulk signing** (one ceremony for many counterparties) — Phase 3 if requested
- **In-document inline signature fields** (place signature at specific PDF coordinates) — Phase 3; F1 uses signature blocks at end-of-document
- **Contract templates marketplace** (10 pre-built starters) — Phase 3 alongside workflow templates
- **Conditional approval logic** ("amount > X requires VP; product=Y requires Legal") — Phase 3, see D8
- **Approval delegation** (approver delegates to assistant during PTO) — Phase 3, see D7
- **Parallel multi-signer ceremonies** (all signers sign simultaneously, not in order) — Phase 3, see D3
- **Approval reminders** (separate cron from F1 reminders) — Phase 2.1.1 polish if approver complaints surface
- **Approval analytics dashboard** (avg time-to-decide per approver, bottleneck detection) — Phase 5 (Pipeline analytics tier)
- **Witness signers / notarization** — eIDAS SES does not require; QES feature for Phase 5+
- **Contract amendments / addenda flow** (mutate post-signature) — Phase 3
- **Contract renewal automation** (auto-spawn new contract on renewalDate) — Phase 3 workflow engine integration

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| eIDAS SES non-compliance discovered by lawyer after build | M | H | Build to SES checklist (Story F1.7), feature flag `CONTRACT_ESIGN_ENABLED=false` in prod, lawyer review gates prod flip, `docs/ESIGN_COMPLIANCE.md` documents exact capabilities and limitations [depășește contextul: lawyer required] |
| PDF tampering bypass via MinIO direct write | L | H | Hash compare at sign + finalize (Story F1.3); MinIO bucket policy restricts write to API service role only; cron weekly integrity check on a sample of signed contracts |
| Signature canvas not keyboard-accessible | M | M | Type-name-as-cursive-PNG alternative (Story F3.3); accessibility-auditor audit |
| Approval state-machine race condition allows double-approve | L | H | SELECT FOR UPDATE in /decide tx + property-based tests (fast-check) prove single-advance under N concurrent decisions |
| Notification dispatch failures block decide transaction | L | M | Notifications enqueued via BullMQ after tx commit; failures recorded but never block; retry per webhook backoff schedule |
| `pdfkit` rendering limits on complex templates | M | M | Cap template at 20 pages; renderer rejects > 50 placeholders per template; performance test in CI |
| Cross-tenant approver assignment leaks user existence | L | M | Approver-ID existence check runs inside `runWithTenant`; same 400 INVALID_APPROVER regardless of whether the ID exists in another tenant |
| `fast-check` adds significant CI time | M | L | Property test budget capped at 100 runs per property in CI; full 1000-run sweep on nightly; results cached |
| Bug bash uncovers Phase 1 regressions late | M | M | F3 starts day 11 of Phase 2; 5 day buffer; P0 blockers shift release by 1 week max |
| Lawyer review takes longer than 1 week | H | M | Prod ships with flag OFF; staging usable for client demos; alternative DocuSign integration path documented as Phase 3 fallback |

---

## Phase 2 → Phase 3 dependencies

Per `ROADMAP_V2.md` §3 (dependencies graph), Phase 2 outputs that Phase 3 (Visual workflow designer) needs:
- **Approvals subjectType extension** enables Phase 3 workflow "approval node" (request approval from inside a workflow run)
- **Contract send-after-approval** pattern is the prototype for Phase 3 "wait-for-approval" workflow step
- **eIDAS SES audit trail** is the pattern reused for any future Phase 3 workflow audit needs
- **Property-based testing harness** added in Phase 2 (`fast-check`) is reused for Phase 3 workflow engine state-machine verification
