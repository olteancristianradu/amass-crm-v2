-- S25 part 1: Attachment versioning (used for offer revisions).
-- We keep the chain flat: every non-root row points at the root's id via
-- parent_id. `version` starts at 1 and increments on each new-version POST.
-- `is_latest` is denormalised so list(?latestOnly=true) is a cheap lookup.

ALTER TABLE "attachments"
    ADD COLUMN "parent_id" TEXT,
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "is_latest" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "attachments_tenantId_parent_id_idx" ON "attachments"("tenantId", "parent_id");

ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- S25 part 2: Email open/click tracking.

CREATE TYPE "EmailTrackKind" AS ENUM ('OPEN', 'CLICK');

CREATE TABLE "email_tracks" (
    "id"         TEXT NOT NULL,
    "tenant_id"  TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "kind"       "EmailTrackKind" NOT NULL,
    "url"        TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tracks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_tracks_tenant_id_message_id_created_at_idx"
    ON "email_tracks"("tenant_id", "message_id", "created_at");
CREATE INDEX "email_tracks_tenant_id_kind_created_at_idx"
    ON "email_tracks"("tenant_id", "kind", "created_at");

ALTER TABLE "email_tracks" ADD CONSTRAINT "email_tracks_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "email_messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same pattern as every other tenant-scoped table.
ALTER TABLE "email_tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_tracks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "email_tracks_tenant_isolation" ON "email_tracks"
    USING (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "email_tracks" TO app_user;
