-- S41 WhatsApp, S42 ANAF, S43 Calendar, S44 Report Builder, S45 Lead Scoring, S46 Portal

-- ─── S41 WhatsApp Business ────────────────────────────────────────────────────
CREATE TYPE "WhatsappMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "WhatsappMessageStatus"    AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

CREATE TABLE "whatsapp_accounts" (
  "id"                   TEXT NOT NULL,
  "tenant_id"            TEXT NOT NULL,
  "phone_number_id"      TEXT NOT NULL,
  "display_phone_number" TEXT NOT NULL,
  "access_token_enc"     TEXT NOT NULL,
  "webhook_verify_token" TEXT NOT NULL,
  "is_active"            BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  "deleted_at"           TIMESTAMP(3),
  CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_accounts_tenant_id_is_active_idx" ON "whatsapp_accounts"("tenant_id", "is_active");

CREATE TABLE "whatsapp_messages" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "account_id"  TEXT NOT NULL,
  "subjectType" "SubjectType" NOT NULL,
  "subject_id"  TEXT NOT NULL,
  "direction"   "WhatsappMessageDirection" NOT NULL,
  "status"      "WhatsappMessageStatus" NOT NULL DEFAULT 'SENT',
  "from_number" TEXT NOT NULL,
  "to_number"   TEXT NOT NULL,
  "body"        TEXT,
  "media_url"   TEXT,
  "media_type"  TEXT,
  "external_id" TEXT,
  "sent_at"     TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "read_at"     TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_messages_external_id_key" UNIQUE ("external_id"),
  CONSTRAINT "whatsapp_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "whatsapp_messages_tenant_subject_idx" ON "whatsapp_messages"("tenant_id", "subjectType", "subject_id", "created_at");
CREATE INDEX "whatsapp_messages_tenant_account_idx" ON "whatsapp_messages"("tenant_id", "account_id");

-- ─── S42 ANAF e-Factura ───────────────────────────────────────────────────────
CREATE TYPE "AnafSubmissionStatus" AS ENUM ('PENDING', 'UPLOADED', 'IN_VALIDATION', 'OK', 'NOK', 'FAILED');

CREATE TABLE "anaf_submissions" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "invoice_id"    TEXT NOT NULL,
  "status"        "AnafSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "upload_index"  TEXT,
  "download_id"   TEXT,
  "error_message" TEXT,
  "xml_content"   TEXT,
  "submitted_at"  TIMESTAMP(3),
  "validated_at"  TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "anaf_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "anaf_submissions_invoice_id_key" UNIQUE ("invoice_id")
);
CREATE INDEX "anaf_submissions_tenant_id_status_idx"    ON "anaf_submissions"("tenant_id", "status");
CREATE INDEX "anaf_submissions_tenant_id_invoice_id_idx" ON "anaf_submissions"("tenant_id", "invoice_id");

-- ─── S43 Calendar Sync ────────────────────────────────────────────────────────
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'OUTLOOK');

CREATE TABLE "calendar_integrations" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "provider"         "CalendarProvider" NOT NULL,
  "access_token_enc" TEXT NOT NULL,
  "refresh_token_enc" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "calendar_id"      TEXT,
  "is_active"        BOOLEAN NOT NULL DEFAULT TRUE,
  "last_sync_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  "deleted_at"       TIMESTAMP(3),
  CONSTRAINT "calendar_integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_integrations_tenant_user_provider_key" UNIQUE ("tenant_id", "user_id", "provider")
);
CREATE INDEX "calendar_integrations_tenant_user_idx" ON "calendar_integrations"("tenant_id", "user_id");

CREATE TABLE "calendar_events" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "external_id"    TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "start_at"       TIMESTAMP(3) NOT NULL,
  "end_at"         TIMESTAMP(3) NOT NULL,
  "location"       TEXT,
  "attendees"      JSONB,
  "subjectType"    "SubjectType",
  "subject_id"     TEXT,
  "synced_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_events_integration_external_key" UNIQUE ("integration_id", "external_id"),
  CONSTRAINT "calendar_events_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "calendar_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "calendar_events_tenant_integration_idx" ON "calendar_events"("tenant_id", "integration_id");
CREATE INDEX "calendar_events_tenant_subject_idx"     ON "calendar_events"("tenant_id", "subjectType", "subject_id");

-- ─── S44 Report Builder ───────────────────────────────────────────────────────
CREATE TYPE "ReportEntityType" AS ENUM ('DEAL', 'COMPANY', 'CONTACT', 'CLIENT', 'INVOICE', 'QUOTE', 'CALL', 'ACTIVITY');

CREATE TABLE "report_templates" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "entity_type"  "ReportEntityType" NOT NULL,
  "config"       JSONB NOT NULL,
  "is_shared"    BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by_id" TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  "deleted_at"   TIMESTAMP(3),
  CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_templates_tenant_entity_idx"     ON "report_templates"("tenant_id", "entity_type");
CREATE INDEX "report_templates_tenant_created_by_idx" ON "report_templates"("tenant_id", "created_by_id");

-- ─── S45 Lead Scoring ─────────────────────────────────────────────────────────
CREATE TABLE "lead_scores" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id"   TEXT NOT NULL,
  "score"       INTEGER NOT NULL,
  "factors"     JSONB NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_scores_tenant_entity_type_entity_id_key" UNIQUE ("tenant_id", "entity_type", "entity_id")
);
CREATE INDEX "lead_scores_tenant_type_score_idx" ON "lead_scores"("tenant_id", "entity_type", "score");

-- ─── S46 Client Portal ────────────────────────────────────────────────────────
CREATE TABLE "portal_tokens" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "company_id" TEXT,
  "client_id"  TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_tokens_token_key" UNIQUE ("token")
);
CREATE INDEX "portal_tokens_tenant_email_idx" ON "portal_tokens"("tenant_id", "email");
CREATE INDEX "portal_tokens_token_idx"         ON "portal_tokens"("token");
