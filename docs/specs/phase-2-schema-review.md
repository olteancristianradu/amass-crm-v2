# Phase 2 — Schema Review (E-sign + Multi-step Approval Workflows)

> Reviewer: `database-architect` · Generated 2026-05-17 · Branch `main` @ `76f42c6` (1.0.0-rc.3 / Phase 1 close)
> Verdict: **APPROVE WITH CHANGES** (6 blockers + 4 concerns — see §10)
> Markers: `[verificat]` = tool-confirmed în cod · `[propus]` = nou introdus în această review · `[presupun]` = inferență fără verificare directă · `[trebuie validat cu avocat]` = legal.

---

## 0. TL;DR

Phase 2 introduce **două domenii** cu **scenarii diferite** de migration:

| Domeniu | Strategie | Modele existente |
|---|---|---|
| **E-sign** | NEW: `ContractTemplate`, `ContractSignature`, `ContractSignatureEvent`, `ContractAuditEntry`. EXTEND `Contract` cu `signingStatus` + `templateId` + `pdfStorageKey` + `pdfHash`. | `Contract` exists `[verificat: schema.prisma:2249]`, fără signing flow. |
| **Approvals multi-step** | EXTEND `ApprovalPolicy` + `ApprovalRequest` pentru multi-step graph + polymorphic subject. NEW: `ApprovalStep`. Replace single `quoteId` cu `(subjectType, subjectId)` și introducere etape ordonate. | `ApprovalPolicy/Request/Decision` exist `[verificat: schema.prisma:1593-1663]`, dar **single-step + quote-only**. |

**Total: 7 migrations** split per regula `ALTER TYPE` (Postgres restriction: `ALTER TYPE ... ADD VALUE` nu rulează în tranzacția care folosește valoarea — splitting obligatoriu).

| # | Migration | Type | Files |
|---|---|---|---|
| A | `20260520100000_phase2_contract_signing_enums` + `20260520100100_phase2_contract_signing_tables` | NEW + EXTEND Contract | 2 |
| B | `20260520110000_phase2_contract_templates` | NEW table | 1 |
| C | `20260520120000_phase2_contract_audit` | NEW table (eIDAS audit trail) | 1 |
| D | `20260520130000_phase2_approval_step_enums` + `20260520130100_phase2_approval_polymorphic` | EXTEND ApprovalPolicy/Request | 2 |
| E | `20260520140000_phase2_approval_steps_table` | NEW table | 1 |

**Total: 7 SQL files / 5 logical migrations.**

**Decizii cheie:**
- Signature image → **MinIO**, nu DB (CLAUDE.md rule #12). DB stochează `signatureStorageKey` + `signatureHash`. `[propus]`
- PDF rendered → **MinIO**. DB stochează `pdfStorageKey` + `pdfHash` (SHA-256 al PDF-ului semnat). `[propus]`
- Audit trail eIDAS → **tabel separat** `ContractAuditEntry` cu hash-chaining (`prevEntryHash`) — append-only, tamper-evident. NU stocat în `audit_logs` general pentru că retention diferă (7 ani per Cod Fiscal RO art. 25(1) lit. e, vs. 90-365 zile audit_logs). `[trebuie validat cu avocat]`
- ApprovalRequest devine polymorphic prin `(subjectType, subjectId)` consistent cu Notes/Attachments — dar folosește `ApprovalSubjectType` enum dedicat (DEAL/CONTRACT/INVOICE/QUOTE/EXPENSE), NU global `SubjectType` care e doar COMPANY/CONTACT/CLIENT.
- `quoteId` column păstrat ca `@deprecated` cu backfill → 2-phase rollout (Phase 2.0 dual-write, Phase 2.6 drop).

---

## 1. Existing inventory (live verified)

| Model | Path | Status |
|---|---|---|
| `Contract` | `schema.prisma:2249` `[verificat]` | EXISTS — missing signing flow |
| `ContractStatus` enum | `schema.prisma:2241` `[verificat]` | EXISTS — DRAFT/ACTIVE/EXPIRED/TERMINATED/RENEWED. NU are `PENDING_SIGNATURE`. |
| `ContractTemplate` | n/a `[verificat: nu există]` | NEW |
| `ContractSignature` | n/a `[verificat: nu există]` | NEW |
| `ContractSignatureEvent` | n/a `[verificat: nu există]` | NEW |
| `ContractAuditEntry` | n/a `[verificat: nu există]` | NEW |
| `ApprovalPolicy` | `schema.prisma:1608` `[verificat]` | EXISTS — single-step, quote-only |
| `ApprovalRequest` | `schema.prisma:1630` `[verificat]` | EXISTS — `quoteId` only |
| `ApprovalDecision` | `schema.prisma:1650` `[verificat]` | EXISTS — flat, no `stepId` |
| `ApprovalStep` | n/a `[verificat: nu există]` | NEW |
| `ApprovalStatus` enum | `schema.prisma:1595` `[verificat]` | EXISTS — PENDING/APPROVED/REJECTED/CANCELLED. NU are `IN_PROGRESS` pentru multi-step. |
| `ApprovalPolicyTrigger` enum | `schema.prisma:1602` `[verificat]` | EXISTS — QUOTE_ABOVE_VALUE/DISCOUNT_ABOVE_PCT only. Phase 2 adaugă CONTRACT_VALUE_ABOVE, EXPENSE_ABOVE_VALUE, DEAL_DISCOUNT_ABOVE_PCT, MANUAL. |
| `NotificationType` enum | `schema.prisma:1921-1929` `[verificat]` | Are `APPROVAL_REQUEST` + `APPROVAL_DECIDED`. Phase 2 adaugă `CONTRACT_SIGNATURE_REQUESTED`, `CONTRACT_SIGNED`, `CONTRACT_DECLINED`. |
| Service `approvals` | `apps/api/src/modules/approvals/approvals.service.ts:105` `[verificat]` | Single-step logic: creează 1 request per policy match. **Phase 2 trebuie refactor.** |
| `TENANT_SCOPED_MODELS` | `prisma.service.ts:14-111` `[verificat]` | Contains `Contract`, `ApprovalPolicy/Request/Decision`. **TREBUIE adăugat**: `ContractTemplate`, `ContractSignature`, `ContractSignatureEvent`, `ContractAuditEntry`, `ApprovalStep`. |

**Volum estimat (Phase 2):**
- Contract signatures: 10 tenants × 50 contracts/lună × 2 semnatari = **1k signatures/lună/10 tenants** → 10k/an la 10 tenants. Nepublic. Tranzacții izolate.
- Audit entries: ~10 events per signature (created, sent, viewed, signed, downloaded, etc.) → **100k audit_entries/an la 10 tenants**. La 1k tenants → 10M/an. **Partitioning needed >5y horizon** `[propus]`, dar **NOT pentru Phase 2.0**.
- Approval requests multi-step: ~20 requests/lună/tenant × 3 steps avg = 60 decisions/lună. **Nu necesită partitioning în orizont 5 ani.** `[verificat reasoning]`

---

## 2. Migration A — Contract Signing (extend Contract + NEW ContractSignature/Event)

### 2.1 Prisma diff

```prisma
// EXTEND existing enum at schema.prisma:2241 — ALTER TYPE split obligatoriu
enum ContractStatus {
  DRAFT
  PENDING_SIGNATURE  // <-- NEW
  ACTIVE
  EXPIRED
  TERMINATED
  RENEWED
  DECLINED           // <-- NEW (toate părţile au refuzat sau au expirat)
}

// NEW: per-signature state machine
enum ContractSignatureStatus {
  PENDING       // ceremony creată, link nu a fost trimis
  SENT          // email trimis semnatarului
  VIEWED        // semnatarul a deschis link-ul (first-touch logged)
  SIGNED        // a semnat
  DECLINED      // a refuzat explicit
  EXPIRED       // ceremony token a expirat (TTL implicit 14 zile)
  VOIDED        // owner-ul contractului a anulat ceremony înainte de signing
}

enum ContractSignerRole {
  TENANT_OWNER  // partea care a creat contractul (companie internă)
  COUNTERPARTY  // partea externă (client)
  WITNESS       // martor (opțional, eIDAS QES requirement în unele jurisdicții)
}

// EXTEND existing model at schema.prisma:2249
model Contract {
  // ...existing fields preserved...
  templateId       String?  @map("template_id")                                    // <-- NEW: FK la ContractTemplate
  pdfStorageKey    String?  @map("pdf_storage_key")                                // <-- NEW: MinIO key al PDF-ului final (signed)
  pdfHash          String?  @map("pdf_hash") @db.VarChar(64)                       // <-- NEW: SHA-256 hex al PDF-ului la sealing
  signingExpiresAt DateTime? @map("signing_expires_at")                            // <-- NEW: deadline ceremony
  signingMode      String?  @default("PARALLEL") @map("signing_mode") @db.VarChar(16) // <-- NEW: "PARALLEL" sau "SEQUENTIAL"
  // ...existing relations...
  template         ContractTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  signatures       ContractSignature[]
  auditEntries     ContractAuditEntry[]

  @@index([tenantId, signingExpiresAt]) // <-- NEW: worker pentru EXPIRED transition
  // ...existing indexes preserved...
}

// NEW model: per-signer ceremony state
model ContractSignature {
  id                  String                  @id @default(cuid())
  tenantId            String                  @map("tenant_id")
  contractId          String                  @map("contract_id")
  signerEmail         String                  @map("signer_email") @db.VarChar(320)  // RFC 5321 max
  signerName          String                  @map("signer_name") @db.VarChar(255)
  signerRole          ContractSignerRole      @default(COUNTERPARTY) @map("signer_role")
  /// Order in SEQUENTIAL mode; ignored în PARALLEL. 0 = first.
  signingOrder        Int                     @default(0) @map("signing_order")
  /// 256-bit HMAC token (64-hex). PRIVATE — never logged.
  ceremonyToken       String                  @unique @map("ceremony_token") @db.VarChar(64)
  /// HMAC key version pentru rotation (`v1`, `v2`).
  ceremonyTokenKid    String                  @default("v1") @map("ceremony_token_kid") @db.VarChar(8)
  status              ContractSignatureStatus @default(PENDING)
  /// MinIO key — image-ul desenat (PNG, ~50KB). NULL pentru DECLINED/EXPIRED.
  signatureStorageKey String?                 @map("signature_storage_key")
  /// SHA-256 al imaginii signature pentru tamper-evidence.
  signatureHash       String?                 @map("signature_hash") @db.VarChar(64)
  /// Coordonatele și timestamp-urile gesturilor canvas → JSON (opțional, eIDAS AES proof).
  signatureProof      Json?                   @map("signature_proof")
  declineReason       String?                 @map("decline_reason") @db.VarChar(2048)
  /// Lifecycle timestamps — toate UTC, naive în DB, conversia FE.
  sentAt              DateTime?               @map("sent_at")
  firstViewedAt       DateTime?               @map("first_viewed_at")
  signedAt            DateTime?               @map("signed_at")
  declinedAt          DateTime?               @map("declined_at")
  expiresAt           DateTime                @map("expires_at")
  /// Network forensics — capturate la signing, păstrate 7 ani per Cod Fiscal.
  ipAddress           String?                 @map("ip_address") @db.VarChar(64)
  userAgent           String?                 @map("user_agent") @db.VarChar(512)
  /// Geolocation aprox (city/country level), din IP la signing. NULL dacă VPN/no-resolve.
  signerGeoCity       String?                 @map("signer_geo_city") @db.VarChar(128)
  signerGeoCountry    String?                 @map("signer_geo_country") @db.VarChar(2)
  createdAt           DateTime                @default(now()) @map("created_at")
  updatedAt           DateTime                @updatedAt @map("updated_at")

  contract Contract                  @relation(fields: [contractId], references: [id], onDelete: Cascade)
  events   ContractSignatureEvent[]
  audit    ContractAuditEntry[]

  @@unique([contractId, signerEmail], map: "contract_signatures_contract_email_uniq")
  @@index([tenantId, contractId, signingOrder], map: "contract_signatures_tenant_contract_order_idx")
  @@index([tenantId, status, expiresAt], map: "contract_signatures_tenant_status_expires_idx")
  @@map("contract_signatures")
}

// NEW: per-signature lifecycle event log (high-cardinality, audit complement)
model ContractSignatureEvent {
  id          String   @id @default(cuid())
  tenantId    String   @map("tenant_id")
  signatureId String   @map("signature_id")
  /// "SENT", "VIEWED", "SIGNED", "DECLINED", "REMINDER_SENT", "DOWNLOADED", "TOKEN_REISSUED"
  eventType   String   @map("event_type") @db.VarChar(32)
  ipAddress   String?  @map("ip_address") @db.VarChar(64)
  userAgent   String?  @map("user_agent") @db.VarChar(512)
  /// Free-form metadata: { httpStatus, smtpResponse, errorCode }
  metadata    Json?
  createdAt   DateTime @default(now()) @map("created_at")

  signature ContractSignature @relation(fields: [signatureId], references: [id], onDelete: Cascade)

  @@index([tenantId, signatureId, createdAt], map: "contract_signature_events_tenant_sig_created_idx")
  @@map("contract_signature_events")
}
```

### 2.2 SQL migration A.1 — enums only

Path: `apps/api/prisma/migrations/20260520100000_phase2_contract_signing_enums/migration.sql`

```sql
-- Phase 2 A.1 — Contract signing enums.
-- SEPARATE from columns migration because `ALTER TYPE ... ADD VALUE` cannot
-- run in the same transaction that uses the new value (Postgres restriction).
-- New enum values added to ContractStatus, plus 2 new enums.

ALTER TYPE "ContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_SIGNATURE';
ALTER TYPE "ContractStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

CREATE TYPE "ContractSignatureStatus" AS ENUM (
  'PENDING', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED'
);

CREATE TYPE "ContractSignerRole" AS ENUM (
  'TENANT_OWNER', 'COUNTERPARTY', 'WITNESS'
);
```

### 2.3 SQL migration A.2 — tables + columns + RLS

Path: `apps/api/prisma/migrations/20260520100100_phase2_contract_signing_tables/migration.sql`

```sql
-- Phase 2 A.2 — Contract signing tables + Contract extends.
-- Runs in a fresh transaction (enums committed în migration A.1).

-- EXTEND contracts table
ALTER TABLE "contracts"
  ADD COLUMN "template_id"          TEXT,
  ADD COLUMN "pdf_storage_key"      TEXT,
  ADD COLUMN "pdf_hash"             VARCHAR(64),
  ADD COLUMN "signing_expires_at"   TIMESTAMP(3),
  ADD COLUMN "signing_mode"         VARCHAR(16) DEFAULT 'PARALLEL';

-- CHECK constraint pentru signing_mode (Postgres nu acceptă enum-modif sigur post-hoc; mai bine VARCHAR + CHECK)
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_signing_mode_chk"
  CHECK ("signing_mode" IN ('PARALLEL', 'SEQUENTIAL'));

-- Worker pentru EXPIRED transition: SELECT contracts WHERE signing_expires_at < NOW() AND status='PENDING_SIGNATURE'.
CREATE INDEX "contracts_tenant_signing_expires_idx"
  ON "contracts" ("tenant_id", "signing_expires_at")
  WHERE "signing_expires_at" IS NOT NULL AND "status" = 'PENDING_SIGNATURE';

-- NEW: contract_signatures
CREATE TABLE "contract_signatures" (
  "id"                     TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "contract_id"            TEXT NOT NULL,
  "signer_email"           VARCHAR(320) NOT NULL,
  "signer_name"            VARCHAR(255) NOT NULL,
  "signer_role"            "ContractSignerRole" NOT NULL DEFAULT 'COUNTERPARTY',
  "signing_order"          INTEGER NOT NULL DEFAULT 0,
  "ceremony_token"         VARCHAR(64) NOT NULL,
  "ceremony_token_kid"     VARCHAR(8) NOT NULL DEFAULT 'v1',
  "status"                 "ContractSignatureStatus" NOT NULL DEFAULT 'PENDING',
  "signature_storage_key"  TEXT,
  "signature_hash"         VARCHAR(64),
  "signature_proof"        JSONB,
  "decline_reason"         VARCHAR(2048),
  "sent_at"                TIMESTAMP(3),
  "first_viewed_at"        TIMESTAMP(3),
  "signed_at"              TIMESTAMP(3),
  "declined_at"            TIMESTAMP(3),
  "expires_at"             TIMESTAMP(3) NOT NULL,
  "ip_address"             VARCHAR(64),
  "user_agent"             VARCHAR(512),
  "signer_geo_city"        VARCHAR(128),
  "signer_geo_country"     VARCHAR(2),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- Unique token GLOBAL — singura lookup la callback este `WHERE ceremony_token=$1`.
-- Token-ul include tenant_id în HMAC input, deci nu necesită composite cu tenant_id.
CREATE UNIQUE INDEX "contract_signatures_ceremony_token_uniq"
  ON "contract_signatures" ("ceremony_token");

-- Unique (contract_id, signer_email): un email nu poate fi semnatar de 2 ori pe același contract.
CREATE UNIQUE INDEX "contract_signatures_contract_email_uniq"
  ON "contract_signatures" ("contract_id", "signer_email");

-- Listing order pentru SEQUENTIAL mode + contract detail UI.
CREATE INDEX "contract_signatures_tenant_contract_order_idx"
  ON "contract_signatures" ("tenant_id", "contract_id", "signing_order");

-- Worker EXPIRED transition: SELECT signatures WHERE status='SENT' AND expires_at < NOW().
CREATE INDEX "contract_signatures_tenant_status_expires_idx"
  ON "contract_signatures" ("tenant_id", "status", "expires_at");

-- FKs
ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS canonical pattern (matches outbox_events, campaign_recipients).
ALTER TABLE "contract_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_signatures" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_signatures ON "contract_signatures"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_signatures" TO app_user;

-- NEW: contract_signature_events
CREATE TABLE "contract_signature_events" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "signature_id" TEXT NOT NULL,
  "event_type"   VARCHAR(32) NOT NULL,
  "ip_address"   VARCHAR(64),
  "user_agent"   VARCHAR(512),
  "metadata"     JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_signature_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_signature_events_tenant_sig_created_idx"
  ON "contract_signature_events" ("tenant_id", "signature_id", "created_at");

ALTER TABLE "contract_signature_events"
  ADD CONSTRAINT "contract_signature_events_signature_id_fkey"
  FOREIGN KEY ("signature_id") REFERENCES "contract_signatures"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signature_events"
  ADD CONSTRAINT "contract_signature_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signature_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_signature_events" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_signature_events ON "contract_signature_events"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_signature_events" TO app_user;
```

### 2.4 MinIO vs DB pentru signature image

**Decizie: MinIO.** `[propus]` Conform CLAUDE.md rule #12 (binaries → MinIO, never Postgres). DB stochează `signatureStorageKey` (~32 bytes) + `signatureHash` (64 hex).

| Aspect | DB (bytea) | MinIO `[propus]` |
|---|---|---|
| TOAST overhead | Da, >2KB rows split-uite | N/A |
| Backup size | +50KB/signature × 10k/an = 500MB/an la 10 tenants | DB minim |
| Retrieval latency | 1 query | 1 presigned GET (15min TTL) |
| Tamper-evidence | Verifier compute hash în memory | Hash stocat în DB, comparat post-GET |
| GDPR delete | DROP COLUMN (impactos) | Delete object (instant) |
| Layout key | n/a | `{tenantId}/contracts/{contractId}/signatures/{signatureId}.png` |

**Recommended pattern:**
- Upload: FE generează PNG (canvas.toBlob), FE → presigned PUT → MinIO. API primește `storageKey`, computes hash din MinIO HEAD response, stores în DB.
- Verify: post-signing, worker async re-computes hash din MinIO object → mismatch = security incident → status flipped la VOIDED + audit entry.

---

## 3. Migration B — ContractTemplate (NEW)

### 3.1 Prisma diff

```prisma
enum ContractTemplateStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model ContractTemplate {
  id          String                 @id @default(cuid())
  tenantId    String                 @map("tenant_id")
  name        String                 @db.VarChar(255)
  description String?                @db.VarChar(2048)
  /// Markdown sau Handlebars template — variables: {{company.name}}, {{deal.value}}, etc.
  bodyMd      String                 @map("body_md") @db.VarChar(1048576) // 1 MiB max
  /// Schema variables expected: [{ key: "company.name", type: "string", required: true }]
  variables   Json                   @default("[]")
  status      ContractTemplateStatus @default(DRAFT)
  /// Version increment manual sau auto on publish — used pentru audit trail.
  version     Int                    @default(1)
  createdById String?                @map("created_by_id")
  createdAt   DateTime               @default(now()) @map("created_at")
  updatedAt   DateTime               @updatedAt @map("updated_at")
  deletedAt   DateTime?              @map("deleted_at")

  contracts Contract[]

  @@unique([tenantId, name, version], map: "contract_templates_tenant_name_version_uniq")
  @@index([tenantId, status, deletedAt], map: "contract_templates_tenant_status_idx")
  @@map("contract_templates")
}
```

### 3.2 SQL migration B

Path: `apps/api/prisma/migrations/20260520110000_phase2_contract_templates/migration.sql`

```sql
-- Phase 2 B — ContractTemplate: reusable, versioned contract templates per tenant.

CREATE TYPE "ContractTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "contract_templates" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "name"           VARCHAR(255) NOT NULL,
  "description"    VARCHAR(2048),
  "body_md"        VARCHAR(1048576) NOT NULL, -- 1 MiB cap — UX inline editor only; long docs → MinIO via Contract.pdfStorageKey
  "variables"      JSONB NOT NULL DEFAULT '[]',
  "status"         "ContractTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "version"        INTEGER NOT NULL DEFAULT 1,
  "created_by_id"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMP(3),

  CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_templates_tenant_name_version_uniq"
  ON "contract_templates" ("tenant_id", "name", "version")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "contract_templates_tenant_status_idx"
  ON "contract_templates" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK from contracts.template_id → contract_templates.id (added in migration A.2; here ensure FK exists).
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_templates" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_templates ON "contract_templates"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_templates" TO app_user;
```

---

## 4. Migration C — ContractAuditEntry (eIDAS audit trail, hash-chained)

### 4.1 De ce tabel separat, nu `audit_logs`

| Criteriu | `audit_logs` (existing) | `contract_audit_entries` `[propus]` |
|---|---|---|
| Retention | 90-365 zile (general) | **7 ani** (Cod Fiscal RO art. 25(1) lit. e — documente contractuale) `[trebuie validat cu avocat]` |
| Append-only enforcement | Not enforced (`UPDATE` permis) | Trigger-blocked + DENY policy pentru `app_user` UPDATE/DELETE |
| Hash chaining | Nu | Da — `prev_entry_hash` → tamper-evident chain |
| Schema rigidity | `metadata JSONB` free-form | Tipizat strict (event_type enum, actor_type enum) |
| Query pattern | Search by actor/action | Always **per-contract chronological** |

### 4.2 Prisma diff

```prisma
enum ContractAuditEventType {
  TEMPLATE_USED
  CONTRACT_CREATED
  CONTRACT_UPDATED
  PDF_RENDERED
  CEREMONY_CREATED
  SIGNATURE_REQUESTED
  SIGNATURE_LINK_OPENED
  SIGNATURE_DRAWN
  SIGNATURE_SUBMITTED
  SIGNATURE_DECLINED
  SIGNATURE_EXPIRED
  CONTRACT_COMPLETED
  CONTRACT_VOIDED
  PDF_DOWNLOADED
  REMINDER_SENT
  TOKEN_REISSUED
}

enum ContractAuditActorType {
  TENANT_USER       // App user în tenant (User.id)
  SIGNER            // External counterparty (signature.id)
  SYSTEM            // Cron jobs, scheduled tasks
  WEBHOOK           // External callback
}

model ContractAuditEntry {
  id                String                 @id @default(cuid())
  tenantId          String                 @map("tenant_id")
  contractId        String                 @map("contract_id")
  signatureId       String?                @map("signature_id")
  eventType         ContractAuditEventType @map("event_type")
  actorType         ContractAuditActorType @map("actor_type")
  /// User.id sau ContractSignature.id depending pe actorType.
  actorId           String?                @map("actor_id")
  actorEmail        String?                @map("actor_email") @db.VarChar(320)
  actorIp           String?                @map("actor_ip") @db.VarChar(64)
  /// Structured event-specific data: { pdfHash, signatureHash, ceremonyTokenKid, declineReason }.
  payload           Json                   @default("{}")
  /// SHA-256(prev.entry_hash || event_type || actor_id || created_at || payload).
  /// Computed app-side BEFORE INSERT. Tamper-evidence: rebuilding chain
  /// trebuie să match-uiască. Mismatch → security incident.
  entryHash         String                 @map("entry_hash") @db.VarChar(64)
  /// Hash al ultimei entry pentru același contract înainte de această.
  /// NULL pentru prima entry per contract.
  prevEntryHash     String?                @map("prev_entry_hash") @db.VarChar(64)
  createdAt         DateTime               @default(now()) @map("created_at")

  contract  Contract           @relation(fields: [contractId], references: [id], onDelete: Restrict) // <-- Restrict, NU Cascade — audit nu se șterge când contract delete
  signature ContractSignature? @relation(fields: [signatureId], references: [id], onDelete: SetNull)

  /// Ordered scan per-contract pentru chain verification.
  @@index([tenantId, contractId, createdAt], map: "contract_audit_tenant_contract_created_idx")
  /// Tamper-detection lookup: găsește prev entry by hash.
  @@unique([contractId, entryHash], map: "contract_audit_contract_entry_uniq")
  @@map("contract_audit_entries")
}
```

### 4.3 SQL migration C

Path: `apps/api/prisma/migrations/20260520120000_phase2_contract_audit/migration.sql`

```sql
-- Phase 2 C — ContractAuditEntry: hash-chained, tamper-evident audit trail
-- for eIDAS compliance. NU folosim audit_logs general pentru că:
--   1. Retention diferit (7 ani per Cod Fiscal RO art. 25(1) lit. e vs 90d general)
--   2. Append-only enforcement strictă (trigger + DENY pe UPDATE/DELETE pentru app_user)
--   3. Hash chaining: prev_entry_hash pointer la SHA-256-ul intrării precedente.
--      Rebuilding chain detectează orice modificare; mismatch = breach.

CREATE TYPE "ContractAuditEventType" AS ENUM (
  'TEMPLATE_USED', 'CONTRACT_CREATED', 'CONTRACT_UPDATED', 'PDF_RENDERED',
  'CEREMONY_CREATED', 'SIGNATURE_REQUESTED', 'SIGNATURE_LINK_OPENED',
  'SIGNATURE_DRAWN', 'SIGNATURE_SUBMITTED', 'SIGNATURE_DECLINED',
  'SIGNATURE_EXPIRED', 'CONTRACT_COMPLETED', 'CONTRACT_VOIDED',
  'PDF_DOWNLOADED', 'REMINDER_SENT', 'TOKEN_REISSUED'
);

CREATE TYPE "ContractAuditActorType" AS ENUM (
  'TENANT_USER', 'SIGNER', 'SYSTEM', 'WEBHOOK'
);

CREATE TABLE "contract_audit_entries" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "contract_id"      TEXT NOT NULL,
  "signature_id"     TEXT,
  "event_type"       "ContractAuditEventType" NOT NULL,
  "actor_type"       "ContractAuditActorType" NOT NULL,
  "actor_id"         TEXT,
  "actor_email"      VARCHAR(320),
  "actor_ip"         VARCHAR(64),
  "payload"          JSONB NOT NULL DEFAULT '{}',
  "entry_hash"       VARCHAR(64) NOT NULL,
  "prev_entry_hash"  VARCHAR(64),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_audit_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_audit_tenant_contract_created_idx"
  ON "contract_audit_entries" ("tenant_id", "contract_id", "created_at");

CREATE UNIQUE INDEX "contract_audit_contract_entry_uniq"
  ON "contract_audit_entries" ("contract_id", "entry_hash");

ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE; -- RESTRICT pentru a preveni ștergerea de audit cu contractul

ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_signature_id_fkey"
  FOREIGN KEY ("signature_id") REFERENCES "contract_signatures"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE; -- IMPORTANT: NU CASCADE — tenant delete must purge contracts INTAI via GDPR export job

-- RLS pentru read isolation
ALTER TABLE "contract_audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_audit_entries" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_audit ON "contract_audit_entries"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

-- APPEND-ONLY enforcement: app_user nu poate UPDATE sau DELETE direct.
-- Doar SELECT + INSERT. Restoration din backup = DB admin doar.
GRANT SELECT, INSERT ON "contract_audit_entries" TO app_user;
-- INTENȚIONAT NU acordăm UPDATE sau DELETE pentru app_user.

-- Trigger-level defense (in caz că app_user-ul se schimbă):
CREATE OR REPLACE FUNCTION prevent_contract_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'contract_audit_entries is append-only (event=%, id=%)', TG_OP, OLD.id
    USING ERRCODE = '45000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_audit_no_update
  BEFORE UPDATE ON "contract_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_audit_mutation();

CREATE TRIGGER contract_audit_no_delete
  BEFORE DELETE ON "contract_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_audit_mutation();
```

### 4.4 Hash chain protocol (referință)

```typescript
// Computed app-side BEFORE INSERT (security-architect threat model phase-2):
import { createHash } from 'crypto';

function computeEntryHash(args: {
  prevEntryHash: string | null;
  eventType: string;
  actorId: string | null;
  createdAtIso: string;       // server clock, NOT user input
  payload: Record<string, unknown>;
}): string {
  // Canonical JSON encoding (sorted keys) ensures determinism.
  const payloadCanonical = JSON.stringify(args.payload, Object.keys(args.payload).sort());
  const input = [
    args.prevEntryHash ?? 'GENESIS',
    args.eventType,
    args.actorId ?? 'ANONYMOUS',
    args.createdAtIso,
    payloadCanonical,
  ].join('|');
  return createHash('sha256').update(input).digest('hex');
}
```

Verifier (rule-out of scope pentru migration, dar relevant pentru schema):
- Background job nightly per tenant: pentru fiecare `contractId`, scan entries `ORDER BY created_at`, re-compute chain, raise alert dacă mismatch.
- Alertă → `securityAlerts` table (Phase 0) sau Pino + Sentry.

---

## 5. Migration D — Approval polymorphic + multi-step

### 5.1 Problema actuală

Service-ul existent `approvals.service.ts:105` creează **1 request per policy match**, fără steps. Phase 2 cere graph multi-step:

```
ApprovalRequest
  └─ Step 0 (manager L1) → APPROVED → Step 1 (manager L2) → APPROVED → final APPROVED
                        └─ REJECTED → final REJECTED (skip remaining steps)
```

### 5.2 Prisma diff

```prisma
// EXTEND existing enum at schema.prisma:1595
enum ApprovalStatus {
  PENDING
  IN_PROGRESS   // <-- NEW: at least one step approved, more pending
  APPROVED
  REJECTED
  CANCELLED
  EXPIRED       // <-- NEW: deadline trecut fără decizie
}

// EXTEND existing enum at schema.prisma:1602
enum ApprovalPolicyTrigger {
  QUOTE_ABOVE_VALUE
  DISCOUNT_ABOVE_PCT
  CONTRACT_VALUE_ABOVE      // <-- NEW
  EXPENSE_ABOVE_VALUE       // <-- NEW
  DEAL_DISCOUNT_ABOVE_PCT   // <-- NEW
  MANUAL                    // <-- NEW (user-triggered, no auto rule)
}

// NEW enum: polymorphic subject for approvals
enum ApprovalSubjectType {
  QUOTE
  CONTRACT
  DEAL
  INVOICE
  EXPENSE
}

// EXTEND existing model at schema.prisma:1608
model ApprovalPolicy {
  // ...existing fields preserved (id, tenantId, name, trigger, config, isActive, ...)...
  /// Subject type pe care policy se aplică. NULL = applies to QUOTE pentru
  /// backward-compat cu rows existente (backfill default = QUOTE).
  subjectType ApprovalSubjectType @default(QUOTE) @map("subject_type") // <-- NEW
  /// JSON array de step definitions: [{ order: 0, approverId: "u_123", approverRole: null, slaHours: 48 }].
  /// Replaces single `approverId` column.
  stepsConfig Json                @default("[]") @map("steps_config") // <-- NEW
  // approverId  STAYS for backward-compat (treated as step-0 fallback when stepsConfig=[]).
  // ...existing relations preserved...
  @@index([tenantId, subjectType, isActive], map: "approval_policies_tenant_subject_active_idx") // <-- NEW
}

// EXTEND existing model at schema.prisma:1630
model ApprovalRequest {
  // ...existing preserved (id, tenantId, policyId, requestedBy, status, createdAt, updatedAt)...
  /// Polymorphic subject. Replaces `quoteId` (which stays cu @deprecated pentru
  /// 2-phase rollout — see migration plan §5.4).
  subjectType   ApprovalSubjectType? @map("subject_type")  // <-- NEW (nullable pana la backfill)
  subjectId     String?              @map("subject_id")     // <-- NEW
  /// Step curent în execuție. NULL când status în (APPROVED, REJECTED, CANCELLED, EXPIRED).
  currentStepId String?              @map("current_step_id") // <-- NEW FK la ApprovalStep
  /// SLA hard deadline; worker trigger EXPIRED transition.
  expiresAt     DateTime?            @map("expires_at")     // <-- NEW
  completedAt   DateTime?            @map("completed_at")   // <-- NEW
  // quoteId STAYS — nullable, deprecated; backfill: pentru existing rows, set subjectType=QUOTE, subjectId=quoteId.
  // ...existing relations preserved...
  steps         ApprovalStep[]
  currentStep   ApprovalStep? @relation("CurrentStep", fields: [currentStepId], references: [id], onDelete: SetNull)

  @@index([tenantId, subjectType, subjectId], map: "approval_requests_tenant_subject_idx") // <-- NEW
  @@index([tenantId, status, expiresAt], map: "approval_requests_tenant_status_expires_idx") // <-- NEW (EXPIRED worker)
}

// EXTEND ApprovalDecision pentru a referenția step-ul concret
model ApprovalDecision {
  // ...existing preserved (id, tenantId, requestId, deciderId, status, comment, decidedAt)...
  stepId String? @map("step_id") // <-- NEW (nullable pentru backward-compat cu vechi decisions)
  // ...existing relations preserved...
  step ApprovalStep? @relation(fields: [stepId], references: [id], onDelete: SetNull)
}
```

### 5.3 SQL migration D.1 — enums only

Path: `apps/api/prisma/migrations/20260520130000_phase2_approval_step_enums/migration.sql`

```sql
-- Phase 2 D.1 — Approval workflow multi-step enums.
-- SEPARATE migration per ALTER TYPE rule.

ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'CONTRACT_VALUE_ABOVE';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'EXPENSE_ABOVE_VALUE';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'DEAL_DISCOUNT_ABOVE_PCT';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'MANUAL';

CREATE TYPE "ApprovalSubjectType" AS ENUM (
  'QUOTE', 'CONTRACT', 'DEAL', 'INVOICE', 'EXPENSE'
);
```

### 5.4 SQL migration D.2 — columns + backfill (2-phase pattern)

Path: `apps/api/prisma/migrations/20260520130100_phase2_approval_polymorphic/migration.sql`

```sql
-- Phase 2 D.2 — Approval polymorphic + multi-step columns + backfill.
-- 2-phase rollout: în migration we ADD nullable columns + backfill existing rows.
-- DROP COLUMN quote_id în Phase 2.6 (separate migration after 30 zile observation).

-- EXTEND approval_policies
ALTER TABLE "approval_policies"
  ADD COLUMN "subject_type" "ApprovalSubjectType" NOT NULL DEFAULT 'QUOTE',
  ADD COLUMN "steps_config" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "approval_policies_tenant_subject_active_idx"
  ON "approval_policies" ("tenant_id", "subject_type", "is_active")
  WHERE "deleted_at" IS NULL;

-- EXTEND approval_requests
ALTER TABLE "approval_requests"
  ADD COLUMN "subject_type"      "ApprovalSubjectType",
  ADD COLUMN "subject_id"        TEXT,
  ADD COLUMN "current_step_id"   TEXT,
  ADD COLUMN "expires_at"        TIMESTAMP(3),
  ADD COLUMN "completed_at"      TIMESTAMP(3);

-- ALTER existing quote_id → NULLABLE (was NOT NULL) pentru new MANUAL trigger fără quote.
ALTER TABLE "approval_requests"
  ALTER COLUMN "quote_id" DROP NOT NULL;

-- BACKFILL: for existing rows, subjectType=QUOTE, subjectId=quote_id.
-- Idempotent (rerunnable): WHERE clause skips already-backfilled rows.
UPDATE "approval_requests"
  SET "subject_type" = 'QUOTE', "subject_id" = "quote_id"
  WHERE "subject_type" IS NULL AND "quote_id" IS NOT NULL;

-- Defense: orphan rows where quote_id NULL → CANCELLED (shouldn't exist pre-Phase 2)
UPDATE "approval_requests"
  SET "status" = 'CANCELLED', "subject_type" = 'QUOTE', "subject_id" = 'DELETED_QUOTE'
  WHERE "subject_type" IS NULL AND "quote_id" IS NULL;

CREATE INDEX "approval_requests_tenant_subject_idx"
  ON "approval_requests" ("tenant_id", "subject_type", "subject_id");

CREATE INDEX "approval_requests_tenant_status_expires_idx"
  ON "approval_requests" ("tenant_id", "status", "expires_at")
  WHERE "expires_at" IS NOT NULL AND "status" IN ('PENDING', 'IN_PROGRESS');

-- EXTEND approval_decisions
ALTER TABLE "approval_decisions"
  ADD COLUMN "step_id" TEXT;

-- Index for "list all decisions on this step":
CREATE INDEX "approval_decisions_tenant_step_idx"
  ON "approval_decisions" ("tenant_id", "step_id")
  WHERE "step_id" IS NOT NULL;
```

---

## 6. Migration E — ApprovalStep (NEW)

### 6.1 Prisma diff

```prisma
enum ApprovalStepStatus {
  PENDING
  ACTIVE      // current step (înainte de orice decision)
  APPROVED
  REJECTED
  SKIPPED     // policy schimbată mid-flight
}

model ApprovalStep {
  id             String              @id @default(cuid())
  tenantId       String              @map("tenant_id")
  requestId      String              @map("request_id")
  /// Ordering in the workflow. 0-indexed. Multiple steps with same order =
  /// parallel approval (all must approve). Unique (request_id, order)
  /// enforced ONLY when order matters; parallel uses same order.
  order          Int
  /// Specifie un user OR un role. Exact 1 trebuie completat (CHECK below).
  approverId     String?             @map("approver_id")
  approverRole   String?             @map("approver_role") @db.VarChar(64)
  /// SLA per step (hours). NULL = use policy default.
  slaHours       Int?                @map("sla_hours")
  status         ApprovalStepStatus  @default(PENDING)
  /// When this step became ACTIVE.
  startedAt      DateTime?           @map("started_at")
  /// When approved/rejected (decided).
  completedAt   DateTime?           @map("completed_at")
  expiresAt      DateTime?           @map("expires_at")
  createdAt      DateTime            @default(now()) @map("created_at")

  request           ApprovalRequest    @relation(fields: [requestId], references: [id], onDelete: Cascade)
  decisions         ApprovalDecision[]
  currentForRequest ApprovalRequest[]  @relation("CurrentStep")

  /// Listing UI: steps per request în ordine.
  @@index([tenantId, requestId, order], map: "approval_steps_tenant_request_order_idx")
  /// Worker "what's pending for me?": status ACTIVE + approverId match.
  @@index([tenantId, approverId, status], map: "approval_steps_tenant_approver_status_idx")
  /// Worker "what's pending for users in role X?": status ACTIVE + approverRole.
  @@index([tenantId, approverRole, status], map: "approval_steps_tenant_role_status_idx")
  @@map("approval_steps")
}
```

### 6.2 SQL migration E

Path: `apps/api/prisma/migrations/20260520140000_phase2_approval_steps_table/migration.sql`

```sql
-- Phase 2 E — ApprovalStep: per-step state for multi-step approval workflows.

CREATE TYPE "ApprovalStepStatus" AS ENUM (
  'PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'SKIPPED'
);

CREATE TABLE "approval_steps" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "request_id"     TEXT NOT NULL,
  "order"          INTEGER NOT NULL,
  "approver_id"    TEXT,
  "approver_role"  VARCHAR(64),
  "sla_hours"      INTEGER,
  "status"         "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
  "started_at"     TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "expires_at"     TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id"),

  -- CHECK: exact ONE of approver_id / approver_role completat.
  -- Empty (both NULL) = pending assignment; ambele = ambiguous.
  CONSTRAINT "approval_steps_approver_exclusive_chk"
    CHECK (
      ("approver_id" IS NULL AND "approver_role" IS NULL) OR
      ("approver_id" IS NOT NULL AND "approver_role" IS NULL) OR
      ("approver_id" IS NULL AND "approver_role" IS NOT NULL)
    )
);

CREATE INDEX "approval_steps_tenant_request_order_idx"
  ON "approval_steps" ("tenant_id", "request_id", "order");

-- Hot path: approver dashboard "pending for me" — partial index keeps it tight.
CREATE INDEX "approval_steps_tenant_approver_status_idx"
  ON "approval_steps" ("tenant_id", "approver_id", "status")
  WHERE "approver_id" IS NOT NULL AND "status" = 'ACTIVE';

CREATE INDEX "approval_steps_tenant_role_status_idx"
  ON "approval_steps" ("tenant_id", "approver_role", "status")
  WHERE "approver_role" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK from approval_requests.current_step_id → approval_steps.id (set up here ca evită circular FK în D.2)
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_current_step_id_fkey"
  FOREIGN KEY ("current_step_id") REFERENCES "approval_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- FK from approval_decisions.step_id → approval_steps.id
ALTER TABLE "approval_decisions"
  ADD CONSTRAINT "approval_decisions_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_steps" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_steps ON "approval_steps"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_steps" TO app_user;
```

---

## 7. TENANT_SCOPED_MODELS updates

Fișier: `apps/api/src/infra/prisma/prisma.service.ts:14-111`

**ADD (alphabetical):**
- `'ApprovalStep'` — între `'ApprovalRequest'` (linia 19) și `'Attachment'` (linia 20)
- `'ContractAuditEntry'` — între `'Contract'` (linia 40) și `'CustomFieldDef'`
- `'ContractSignature'` — între `'ContractAuditEntry'` și `'CustomFieldDef'`
- `'ContractSignatureEvent'` — între `'ContractSignature'` și `'CustomFieldDef'`
- `'ContractTemplate'` — între `'ContractSignatureEvent'` și `'CustomFieldDef'`

**No-op (already present):**
- `Contract`, `ApprovalDecision`, `ApprovalPolicy`, `ApprovalRequest`

**Regression test:** `prisma.service.spec.ts` introspectează schema și verifică că orice model cu `tenantId` field e în set. Failure → CI blocked.

---

## 8. EXPLAIN ANALYZE — representative queries (pre-merge, seed 100k rows)

Trebuie rulat **pre-merge** pe DB dev seed-uit cu 100k contracts, 200k signatures, 500k audit_entries, 50k approval_requests × 3 steps. Mini-fixture seeder: `apps/api/scripts/seed-phase2-perf.ts` `[propus]`.

### 8.1 Ceremony callback (cea mai frecventă query)

```sql
SET app.tenant_id = '<test-tenant>';
SET ROLE app_user;
EXPLAIN (ANALYZE, BUFFERS) SELECT id, tenant_id, contract_id, status, expires_at
  FROM contract_signatures WHERE ceremony_token = '<known-token>';
```

**Expected plan:** `Index Scan using contract_signatures_ceremony_token_uniq` · cost <0.5 · actual time <1ms · buffers shared hit ≤4. PASS dacă < 2ms p95.

### 8.2 Approver dashboard ("pending for me")

```sql
SET app.tenant_id = '<test-tenant>';
SET ROLE app_user;
EXPLAIN (ANALYZE, BUFFERS) SELECT id, request_id, expires_at
  FROM approval_steps
  WHERE approver_id = '<user-id>' AND status = 'ACTIVE'
  ORDER BY expires_at NULLS LAST LIMIT 50;
```

**Expected plan:** `Index Scan using approval_steps_tenant_approver_status_idx` (partial — ACTIVE only) · cost <2 · actual time <3ms. PASS dacă <5ms p95.

### 8.3 Contract audit chain verification (per-contract scan)

```sql
SET app.tenant_id = '<test-tenant>';
SET ROLE app_user;
EXPLAIN (ANALYZE, BUFFERS) SELECT id, entry_hash, prev_entry_hash, event_type, payload, created_at
  FROM contract_audit_entries
  WHERE contract_id = '<contract-id>'
  ORDER BY created_at ASC;
```

**Expected plan:** `Index Scan using contract_audit_tenant_contract_created_idx`. La 100 entries per contract: <10ms. La 10k entries (worst case anomaly): <50ms. PASS.

### 8.4 EXPIRED worker scan (Phase 2.5 — recurring cron)

```sql
SET ROLE app_user;
-- NO tenant_id setat — worker rulează GLOBAL pentru toate tenants.
-- ATENȚIE: trebuie să folosească `app.tenant_id = 'GLOBAL_BYPASS'` SAU să ruleze ca alt rol (NU app_user).
-- Recommendation: dedicated `app_worker` role, GRANT SELECT pe contract_signatures, RLS USING (true) doar pentru acest role.
EXPLAIN (ANALYZE, BUFFERS) SELECT id, tenant_id, contract_id
  FROM contract_signatures
  WHERE status = 'SENT' AND expires_at < NOW()
  LIMIT 100;
```

**ISSUE: RLS blochează app_user.** Recommendation: introdu rol `app_worker` (separat de app_user) cu RLS bypass pentru cron jobs SI worker reads. Same pattern ca outbox poller. **BLOCKER 5** (vezi §10).

---

## 9. GDPR + retention considerations

### 9.1 Contract signatures + audit

| Date | Retention | Justificare | Action în GDPR delete request |
|---|---|---|---|
| `contracts.value, currency, dates` | **7 ani** post-contract-end | Cod Fiscal RO art. 25(1) lit. e — documente contractuale | Anonimize tenantId reference, păstrează aggregate |
| `contract_signatures.signer_email, signer_name, ip, geo` | **7 ani** | eIDAS audit trail | NU se anonimizează (legal hold trumps GDPR Art. 17 per RGPD Art. 17(3)(b)) |
| `contract_signatures.signature_storage_key` | **7 ani** in MinIO | Same | NU se șterge |
| `contract_audit_entries` | **7 ani** | Same; append-only trigger blochează DELETE oricum | Per-tenant export job — purge tenant doar după 7y |
| `contract_signature_events` | **2 ani** | Operațional, NU legal | Anonymize IP după 90 zile (cron `email_tracks:hash-pii` pattern) |
| `contract_templates` | **fără limită** (tenant-controlled) | Templates aren't PII | Delete on tenant request |

**Implementation:** `apps/api/src/modules/gdpr/gdpr.service.ts` (existing) trebuie extins cu `exportContractSignatures()` + `legalHoldCheck()` care **blochează** delete pentru rows în legal hold window.

### 9.2 Approval workflows

| Date | Retention | Justificare |
|---|---|---|
| `approval_requests` (status FINAL) | **2 ani** | Operațional + audit business |
| `approval_decisions` | **2 ani** | Same |
| `approval_steps` | **2 ani** | Same |
| `approval_policies` | **fără limită** | Configuration |

---

## 10. Blockers + concerns

### BLOCKER 1: Decizie legală asupra eIDAS SES vs AES vs QES

`[trebuie validat cu avocat]` Phase 2 schema implementează **eIDAS SES (Simple Electronic Signature)** + audit hash. Schema **NU** asigură AES (Advanced) sau QES (Qualified) — acelea cer:
- AES: certificat criptografic per signer + control unic asupra signing material.
- QES: certificat eliberat de QTSP (Qualified Trust Service Provider) acreditat ENISA — în RO doar `certSIGN` și încă 2-3 furnizori.

**Recommend:** Pre-prod, avocat confirmă că **SES + hash-chained audit + IP/geo + canvas proof** e suficient pentru:
1. Contractele B2B SMB (Codul Civil art. 1240 admite "manifestare a voinței" prin orice formă, dacă părțile convin).
2. NU pentru: contracte cu sectorul public (cere QES per Legea 455/2001).

Dacă avocat zice "ai nevoie de AES/QES": migration **NU se schimbă**, dar trebuie integrare cu QTSP API (ex. certSIGN PAdES) — adăugăm `signature_pades_envelope_storage_key` + `signature_certificate_id`. **Plan în Phase 2.5 dacă necesar.**

### BLOCKER 2: ALTER TYPE split obligatoriu

5 enum-uri se ALTER + 4 enum-uri noi → 2 migrations distincte per regula Postgres. Migration files A.1 + A.2 și D.1 + D.2 SUNT split. NU permite mai mult în același file.

### BLOCKER 3: `app_worker` role pentru cron jobs

Worker-ul EXPIRED transition (signatures + approval_requests) rulează **fără tenant context**. Cu RLS forțat și `app_user`, scan-ul retournă 0 rows.

**Fix:** introduce rol `app_worker` în migration `20260520105000_phase2_app_worker_role` (precede tabelele):

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
END $$;

-- app_worker bypass RLS — RESTRICTIV: ONLY SELECT pe tabele specifice.
ALTER USER amass_api WITH BYPASSRLS;  -- WRONG, NU face asta
-- CORECT: per-table policy adițională:
CREATE POLICY worker_global_select_signatures ON "contract_signatures"
  FOR SELECT TO app_worker USING (TRUE);
-- Și GRANT SELECT pe tabel pentru app_worker.
```

Service layer (`apps/api/src/infra/prisma/prisma.service.ts`) trebuie să expună `runAsWorker(fn)` care face `SET LOCAL ROLE app_worker` în transaction. **NEW API** — backend-engineer scope.

### BLOCKER 4: `prevent_contract_audit_mutation` trigger funcție

Funcția PostgreSQL `prevent_contract_audit_mutation()` trebuie creată **înainte** de triggers (acelasi migration file). În prezent ordinea în §4.3 e corectă. Dar dacă admin face rollback manual via `prisma migrate reset` și apoi reapply, funcția existentă trebuie `CREATE OR REPLACE`. **Already handled** în SQL.

### BLOCKER 5: `quote_id` deprecation 2-phase rollout

Migration D.2 ALTER `quote_id` la NULLABLE + backfill subjectType/subjectId. **Phase 2.6** (30 zile post-prod): separate migration `DROP COLUMN quote_id` + remove FK la quotes. Pre-condition: zero reads din `quote_id` în production logs (verify cu `pg_stat_user_tables` + Sentry).

**Plan timeline:**
1. Phase 2.0 (migration D.2): ADD nullable cols, backfill, app dual-writes (writes la nou + la `quote_id`).
2. Phase 2.3 (≥ 14 zile post-deploy): app reads doar din nou. Dual-write păstrat.
3. Phase 2.6 (≥ 30 zile post-deploy): separate migration DROP COLUMN.

Failure mode dacă sărim peste: rollback la Phase 2.0 imposibil (quote_id are date noi în coloana noua, dar nu și vechea).

### BLOCKER 6: TENANT_SCOPED_MODELS sync

Cele 5 modele noi (`ApprovalStep`, `ContractAuditEntry`, `ContractSignature`, `ContractSignatureEvent`, `ContractTemplate`) **MUST** fi adăugate în set înainte de PR merge. Regression test `prisma.service.spec.ts` introspectează schema și fail-uiește pe orice model cu `tenantId` lipsă din set. NU lăsa pe later — testul a prins ScimToken în B3-PR4 (vezi `prisma.service.ts:88-91`).

---

## 11. Concerns (non-blocking, de monitorizat)

### Concern 1: ContractTemplate body_md VARCHAR(1MiB)

Triggers Postgres TOAST > 2KB. Inline editor (TipTap/Slate) va genera <100KB normal. Dacă tenant uploadează template pre-existent >500KB → recommend migration la `Attachment` + storageKey pe `ContractTemplate.bodyStorageKey`. Monitor `pg_class.relpages` for `contract_templates`. Threshold: > 100 MB total → trigger MinIO migration ADR.

### Concern 2: Volume of contract_audit_entries

Estimate: 100 tenants × 50 contracts/lună × 15 audit events = **75k entries/lună/100 tenants**. La 7y retention + 1k tenants growth = **63M rows orizont 7 ani**. NU partitioning în Phase 2.0, **dar** la 10M rows declanșează ADR per CLAUDE.md deferred tech protocol. Watch `pg_stat_user_tables.n_tup_ins` weekly.

### Concern 3: signature_storage_key + signature_hash race condition

Race posibilă: signing endpoint INSERT row cu `status=SIGNED` înainte ca MinIO PUT să se completeze. Mitigare:
1. State machine: `PENDING → SENT → VIEWED → DRAWN_PENDING_UPLOAD → SIGNED`.
2. `DRAWN_PENDING_UPLOAD` (intermediate, **NOT exposed** în enum public — pseudo-state).
3. Backend verifică MinIO HEAD înainte de transition la `SIGNED`.

**Recommend:** introdu `'DRAWN_PENDING_UPLOAD'` valoare în enum cu comentariu "internal-only" `[propus]`, sau folosește un coloana boolean `upload_verified` care gateway-uiește transition.

### Concern 4: fast-check pentru property testing al workflow state machine

ROADMAP_V2 §111-129 cere property-based testing pentru approval state machine. **Verificat** `[verificat]`: `fast-check` NU e în `package.json`. Recommend `qa-automation` adăugă în Phase 2.6:

```bash
pnpm --filter @amass/api add -D fast-check@^4
```

Test scope: pentru orice secvență valid (`createRequest` + N×`approveStep` sau `rejectStep`), state machine ajunge într-o stare finală (APPROVED/REJECTED/CANCELLED/EXPIRED) — niciodată stuck în PENDING/IN_PROGRESS.

---

## 12. Backward compatibility check

| Existing query | Effect post-Phase 2 | Action |
|---|---|---|
| `approvalsService.match(quote)` (`approvals.service.ts:86`) | Behavior preserved — defaults `subject_type='QUOTE'`. | None |
| `ApprovalRequest.quote` relation | STAYS (nullable post-migration). | Service layer must handle null pentru non-quote requests. |
| `contracts.controller.ts` PATCH sets `signedAt` direct | Conflict cu signing flow nou. | Backend: PATCH `signedAt` permis doar dacă status NU e PENDING_SIGNATURE. |
| `Contract.status='ACTIVE'` direct prin PATCH | Permis în continuare (legacy contracts importate). | None — nou flow doar dacă `templateId` setat. |
| Existing notification `APPROVAL_REQUEST` | Used pentru single-step. Phase 2: fired pentru fiecare step transition. | Schema OK. Service: add `metadata.stepOrder` în payload. |

**Niciun breakage hard**: toate field-urile noi sunt nullable sau au DEFAULT.

---

## 13. Action items (handoff backend-engineer)

- [ ] **BLOCKER**: Crează migration `20260520105000_phase2_app_worker_role` ÎNAINTE de A.2 (sau în A.2 head). Coordonează cu security-architect threat model phase-2.md.
- [ ] **BLOCKER**: Implementează `prismaService.runAsWorker(fn)` cu `SET LOCAL ROLE app_worker`. Adaugă spec.
- [ ] **BLOCKER**: Avocat consult — eIDAS SES vs AES validation pentru jurisdicția RO + Cod Civil art. 1240. Document în ADR `docs/adr/phase-2-esign-legal.md`.
- [ ] **BLOCKER**: Update `TENANT_SCOPED_MODELS` cu 5 modele noi. Re-run `prisma.service.spec.ts`.
- [ ] **BLOCKER**: Seeder `scripts/seed-phase2-perf.ts` cu 100k contracts pentru EXPLAIN ANALYZE pre-merge.
- [ ] **BLOCKER**: Audit hash chain — implementare în `apps/api/src/modules/contracts/audit-chain.service.ts` cu nightly verifier job. Test `audit-chain.service.spec.ts` simulează tampered row → alert raised.
- [ ] Refactor `approvals.service.ts:86` → multi-step support. Backward compat pentru existing single-step policies.
- [ ] Implementează `prevent_contract_audit_mutation` UNIT TEST: tentativ UPDATE → expect `45000` SQLSTATE.
- [ ] FE: TipTap editor pentru `contract_templates.body_md`, canvas component pentru `signature_proof`.
- [ ] Property-based test cu fast-check pentru ApprovalRequest state machine (concern 4).
- [ ] Cron jobs noi:
  - `contracts:signing-expire` (hourly): EXPIRED transition pentru signatures peste TTL.
  - `approvals:request-expire` (hourly): EXPIRED transition pentru requests cu `expires_at < NOW()`.
  - `contracts:audit-chain-verify` (nightly per tenant): re-compute hash chain, alert pe mismatch.
- [ ] Webhook events noi: `CONTRACT_SIGNATURE_REQUESTED`, `CONTRACT_SIGNED`, `CONTRACT_DECLINED`, `APPROVAL_STEP_COMPLETED` — add la `WebhookEvent` enum în separate migration (urmare pattern Phase 1 E).
- [ ] Cross-reference cu `docs/threat-models/phase-2.md` (security-architect output) — verifică acoperire ceremony token forgery, MinIO presigned URL leakage, audit hash collision.

---

## VERDICT: APPROVE WITH CHANGES

6 blockers obligatoriu rezolvate pre-merge. Schema OK structural; ceea ce lipsește e:
1. Worker role + RLS bypass scoped (BLOCKER 3).
2. Legal validation (BLOCKER 1).
3. Operational glue (TENANT_SCOPED_MODELS sync, seeder, hash chain code).

Aprobă **după** ce backend-engineer livrează items BLOCKER 3, 4, 6 și avocat confirmă BLOCKER 1.
