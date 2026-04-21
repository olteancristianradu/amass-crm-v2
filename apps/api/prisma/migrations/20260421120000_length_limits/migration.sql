-- M-6: cap free-text columns that previously had no length limit.
-- Prevents per-row payload bombing (e.g. a 10 MB "note") and reduces
-- replication/backup bloat. Limits chosen empirically well above the
-- real-world 99th percentile observed in customer data.

ALTER TABLE "notes" ALTER COLUMN "body" TYPE VARCHAR(10000);
ALTER TABLE "email_messages" ALTER COLUMN "subject" TYPE VARCHAR(998);
ALTER TABLE "email_messages" ALTER COLUMN "bodyHtml" TYPE VARCHAR(1048576);
ALTER TABLE "email_messages" ALTER COLUMN "bodyText" TYPE VARCHAR(262144);
ALTER TABLE "invoice_lines" ALTER COLUMN "description" TYPE VARCHAR(500);
ALTER TABLE "quote_lines" ALTER COLUMN "description" TYPE VARCHAR(500);
