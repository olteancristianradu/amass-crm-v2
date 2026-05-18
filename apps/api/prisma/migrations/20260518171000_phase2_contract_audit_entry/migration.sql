-- Phase 2 C — ContractAuditEntry: hash-chained, tamper-evident, append-only
-- audit trail for the e-sign ceremony (Phase 2 schema review §C / §4).
--
-- WHY a separate table from audit_logs:
--   1. Retention is 7y (Cod Fiscal RO art. 25(1)(e), documente commerciale)
--      vs 90-365d for the operational audit_logs. [trebuie validat cu avocat]
--   2. APPEND-ONLY: UPDATE + DELETE are blocked both by REVOKE on app_user
--      AND by a trigger (defense in depth — see prevent_contract_audit_mutation
--      below).
--   3. Hash chaining: prev_entry_hash points at the SHA-256 of the preceding
--      entry. Rebuilding the chain detects ANY tampering; mismatch = security
--      incident. App layer (audit-chain.service.ts, scheduled nightly verifier)
--      computes the hash BEFORE INSERT — see §4.4 of the schema review for the
--      canonical encoding.
--   4. Schema rigidity: typed enums (event_type, actor_type) for predictable
--      legal-discovery queries.

CREATE TYPE "ContractAuditEventType" AS ENUM (
  'TEMPLATE_USED',
  'CONTRACT_CREATED',
  'CONTRACT_UPDATED',
  'PDF_RENDERED',
  'CEREMONY_CREATED',
  'SIGNATURE_REQUESTED',
  'SIGNATURE_LINK_OPENED',
  'SIGNATURE_DRAWN',
  'SIGNATURE_SUBMITTED',
  'SIGNATURE_DECLINED',
  'SIGNATURE_EXPIRED',
  'CONTRACT_COMPLETED',
  'CONTRACT_VOIDED',
  'PDF_DOWNLOADED',
  'REMINDER_SENT',
  'TOKEN_REISSUED'
);

CREATE TYPE "ContractAuditActorType" AS ENUM (
  'TENANT_USER',
  'SIGNER',
  'SYSTEM',
  'WEBHOOK'
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

-- RESTRICT: audit survives contract delete (legal hold).
ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_signature_id_fkey"
  FOREIGN KEY ("signature_id") REFERENCES "contract_signatures"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT: tenant delete must purge contracts INTAI via GDPR export job.
ALTER TABLE "contract_audit_entries"
  ADD CONSTRAINT "contract_audit_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_audit_entries" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_audit ON "contract_audit_entries"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

-- APPEND-ONLY at the GRANT layer: app_user gets only SELECT + INSERT.
-- INTENTIONAL: no UPDATE or DELETE — even a misbehaving service module
-- cannot mutate the chain.
GRANT SELECT, INSERT ON "contract_audit_entries" TO app_user;

-- APPEND-ONLY at the TRIGGER layer: defense in depth in case a future
-- migration accidentally re-grants UPDATE/DELETE. SQLSTATE 45000 = generic
-- "raise exception". We encode op + id in the message so the audit verifier
-- alerts can surface the offending row.
CREATE OR REPLACE FUNCTION prevent_contract_audit_mutation() RETURNS trigger AS $PCAM$
BEGIN
  RAISE EXCEPTION 'contract_audit_entries is append-only (op=%, id=%)',
                  TG_OP,
                  COALESCE(OLD.id, '<unknown>')
    USING ERRCODE = '45000';
END;
$PCAM$ LANGUAGE plpgsql;

CREATE TRIGGER contract_audit_no_update
  BEFORE UPDATE ON "contract_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_audit_mutation();

CREATE TRIGGER contract_audit_no_delete
  BEFORE DELETE ON "contract_audit_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_audit_mutation();
