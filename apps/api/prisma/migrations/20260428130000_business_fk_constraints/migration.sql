-- M-aud-onDelete: add DB-level FK constraints + ON DELETE behaviour for
-- the most-touched business cross-references that previously lived as
-- plain TEXT columns. RLS + soft-delete already prevent observable
-- cross-tenant orphans, but adding the constraint:
--   1. catches `company.delete` paths that forget to soft-delete first,
--   2. lets Postgres enforce SetNull/Restrict atomically with the parent
--      row's transaction,
--   3. is a free correctness win that doesn't change any service code.
--
-- Strategy mapping (from docs/UNFINISHED.md):
--   • Deal.companyId / Deal.contactId    → SET NULL (deal survives, owner gone)
--   • Task.assigneeId                     → SET NULL (unassign on user delete)
--   • Invoice.companyId                   → RESTRICT (legal preservation)
--
-- All three are safe to add live: no existing rows violate them
-- (ALTER TABLE checks; if any row had a dangling id, the migration
-- would fail loudly here so we'd know).

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
