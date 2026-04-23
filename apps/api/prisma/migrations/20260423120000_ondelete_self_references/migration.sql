-- Add onDelete semantics to the two self-referential relations that were
-- using the Prisma default (NoAction on delete, which blocks deletion if
-- any child points to the parent).
--
-- Company.parent → SetNull:
--   If a parent company is hard-deleted, subsidiaries become root-level
--   instead of being blocked. Safer than Cascade (we don't want to lose
--   subsidiary data) and saner than NoAction (would make tenant-cascade
--   delete fail).
--
-- Attachment.parent → Cascade:
--   When the v1 attachment is deleted, its version history goes with it.
--   Keeps MinIO cleanup consistent.

-- Company.parent_id
ALTER TABLE "companies"
  DROP CONSTRAINT IF EXISTS "companies_parent_id_fkey",
  ADD  CONSTRAINT "companies_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Attachment.parent_id
ALTER TABLE "attachments"
  DROP CONSTRAINT IF EXISTS "attachments_parent_id_fkey",
  ADD  CONSTRAINT "attachments_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "attachments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
