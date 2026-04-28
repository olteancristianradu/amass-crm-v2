-- M-aud-H7: hash portal tokens at rest. Drop the plaintext column and
-- replace with token_hash. All existing tokens (24h TTL) become invalid
-- on this migration, which is acceptable — clients re-request access.
ALTER TABLE "portal_tokens" DROP CONSTRAINT IF EXISTS "portal_tokens_token_key";
DROP INDEX IF EXISTS "portal_tokens_token_idx";

-- Wipe rows so we don't leave orphans. 24h TTL means at most a day's worth
-- of pending magic links; small impact.
DELETE FROM "portal_tokens";

ALTER TABLE "portal_tokens" DROP COLUMN "token";
ALTER TABLE "portal_tokens" ADD COLUMN "token_hash" TEXT NOT NULL;

CREATE UNIQUE INDEX "portal_tokens_token_hash_key" ON "portal_tokens"("token_hash");
CREATE INDEX "portal_tokens_token_hash_idx" ON "portal_tokens"("token_hash");
