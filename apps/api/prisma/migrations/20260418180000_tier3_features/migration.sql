-- S47 Notifications
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_REQUEST','APPROVAL_DECIDED','DEAL_UPDATED','REMINDER_DUE','CALL_COMPLETED','MENTION','SYSTEM');

CREATE TABLE "notifications" (
  "id"         TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "type"       "NotificationType" NOT NULL,
  "title"      TEXT NOT NULL,
  "body"       TEXT,
  "data"       JSONB,
  "is_read"    BOOLEAN NOT NULL DEFAULT false,
  "read_at"    TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "notifications_tenant_user_read_idx" ON "notifications"("tenant_id","user_id","is_read","created_at");

-- S48 Data Export
CREATE TYPE "ExportStatus" AS ENUM ('PENDING','PROCESSING','DONE','FAILED');

CREATE TABLE "data_exports" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       TEXT NOT NULL,
  "requested_by_id" TEXT,
  "entity_type"     TEXT NOT NULL,
  "filters"         JSONB,
  "status"          "ExportStatus" NOT NULL DEFAULT 'PENDING',
  "storage_key"     TEXT,
  "row_count"       INTEGER,
  "error"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completed_at"    TIMESTAMPTZ
);
CREATE INDEX "data_exports_tenant_requester_idx" ON "data_exports"("tenant_id","requested_by_id");

-- S49 SMS
CREATE TYPE "SmsDirection" AS ENUM ('INBOUND','OUTBOUND');
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED','SENT','DELIVERED','FAILED');

CREATE TABLE "sms_messages" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   TEXT NOT NULL,
  "direction"   "SmsDirection" NOT NULL,
  "from_number" TEXT NOT NULL,
  "to_number"   TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "status"      "SmsStatus" NOT NULL DEFAULT 'QUEUED',
  "twilio_sid"  TEXT UNIQUE,
  "contact_id"  TEXT,
  "error"       TEXT,
  "sent_at"     TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "sms_messages_tenant_contact_idx" ON "sms_messages"("tenant_id","contact_id");
CREATE INDEX "sms_messages_tenant_dir_idx" ON "sms_messages"("tenant_id","direction","created_at");

-- S50 Webhooks
CREATE TYPE "WebhookEvent" AS ENUM ('COMPANY_CREATED','COMPANY_UPDATED','CONTACT_CREATED','DEAL_CREATED','DEAL_STATUS_CHANGED','INVOICE_ISSUED','QUOTE_ACCEPTED','CALL_COMPLETED','APPROVAL_DECIDED');

CREATE TABLE "webhook_endpoints" (
  "id"         TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "secret"     TEXT NOT NULL,
  "events"     "WebhookEvent"[] NOT NULL DEFAULT '{}',
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints"("tenant_id");

CREATE TABLE "webhook_deliveries" (
  "id"            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint_id"   TEXT NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "event"         TEXT NOT NULL,
  "payload"       JSONB NOT NULL,
  "status_code"   INTEGER,
  "response_body" TEXT,
  "attempt"       INTEGER NOT NULL DEFAULT 1,
  "success"       BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries"("endpoint_id","created_at");

-- S51 Billing
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID');

CREATE TABLE "billing_subscriptions" (
  "id"                     TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              TEXT NOT NULL UNIQUE,
  "stripe_customer_id"     TEXT UNIQUE,
  "stripe_subscription_id" TEXT UNIQUE,
  "plan"                   TEXT NOT NULL DEFAULT 'starter',
  "status"                 "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "trial_ends_at"          TIMESTAMPTZ,
  "current_period_start"   TIMESTAMPTZ,
  "current_period_end"     TIMESTAMPTZ,
  "cancel_at_period_end"   BOOLEAN NOT NULL DEFAULT false,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
