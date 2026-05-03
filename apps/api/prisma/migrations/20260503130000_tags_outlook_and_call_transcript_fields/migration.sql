-- Create the tables/columns that were added to schema.prisma without a
-- matching migration. A clean CI database applies migrations strictly by
-- directory name, so these objects must exist before
-- 20260503143000_secure_whatsapp_tags_rls enables RLS on them.

ALTER TABLE "call_transcripts"
  ADD COLUMN IF NOT EXISTS "scriptComplianceScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "scriptMissedItems" JSONB;

CREATE TABLE IF NOT EXISTS "tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "entity_tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,

    CONSTRAINT "entity_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "outlook_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "inbox_delta_link" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlook_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tags_tenant_id_idx" ON "tags"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");

CREATE INDEX IF NOT EXISTS "entity_tags_tenant_id_entity_type_entity_id_idx"
  ON "entity_tags"("tenant_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "entity_tags_tenant_id_tag_id_idx"
  ON "entity_tags"("tenant_id", "tag_id");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_tags_tag_id_entity_id_key"
  ON "entity_tags"("tag_id", "entity_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entity_tags_tag_id_fkey'
  ) THEN
    ALTER TABLE "entity_tags"
      ADD CONSTRAINT "entity_tags_tag_id_fkey"
      FOREIGN KEY ("tag_id") REFERENCES "tags"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "outlook_tokens_tenant_id_idx" ON "outlook_tokens"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "outlook_tokens_tenant_id_user_id_key"
  ON "outlook_tokens"("tenant_id", "user_id");
