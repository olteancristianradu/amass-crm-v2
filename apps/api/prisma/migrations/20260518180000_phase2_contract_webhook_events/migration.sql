-- Phase 2 F1 — extend WebhookEvent enum with the 4 e-sign ceremony events.
-- Subscribers can opt into "tell my CRM/Slack/Zapier when a contract was
-- sent / signed / declined / expired" without re-deploying our service.
--
-- Additive (no rename, no drop). Existing webhook subscriptions ignore new
-- values unless explicitly reconfigured. ALTER TYPE ADD VALUE is per-value
-- transactional — Postgres requires they be committed before use, which is
-- already guaranteed because each Prisma migration runs in its own tx
-- separately from the publisher code that reads these values.
--
-- Emitted by:
--   CONTRACT_SENT_FOR_SIGNATURE — ceremony.service.ts after the first email
--                                 dispatches successfully.
--   CONTRACT_SIGNED             — signing.service.ts when the LAST signer
--                                 submits (Contract.status flips to ACTIVE).
--   CONTRACT_DECLINED           — signing.service.ts on first decline, AND
--                                 contract-expire.processor when all signers
--                                 expire and the contract is force-declined.
--   CONTRACT_EXPIRED            — contract-expire.processor when the ceremony
--                                 TTL elapses without all signatures.

ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CONTRACT_SENT_FOR_SIGNATURE';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CONTRACT_SIGNED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CONTRACT_DECLINED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRED';
