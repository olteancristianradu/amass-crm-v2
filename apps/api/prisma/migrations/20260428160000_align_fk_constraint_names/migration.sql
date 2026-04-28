-- Align FK constraint names with Prisma's auto-generated convention.
-- The earlier business_fk_constraints migrations named constraints in
-- camelCase (e.g. "cases_companyId_fkey"); Prisma now generates them
-- from the underlying snake_case column ("cases_company_id_fkey").
-- The constraints are functionally identical — only the names differ —
-- but `prisma migrate diff --exit-code` (CI prisma-drift job) flags the
-- mismatch. This migration renames them to match.
--
-- Plus three relations whose ON DELETE behaviour was missed in the
-- camelCase batch and gets re-added with the schema-declared semantics.

-- AnafSubmission
ALTER TABLE "anaf_submissions" RENAME CONSTRAINT "anaf_submissions_invoiceId_fkey" TO "anaf_submissions_invoice_id_fkey";

-- ApprovalRequest
ALTER TABLE "approval_requests" RENAME CONSTRAINT "approval_requests_quoteId_fkey" TO "approval_requests_quote_id_fkey";

-- Case
ALTER TABLE "cases" RENAME CONSTRAINT "cases_assigneeId_fkey" TO "cases_assignee_id_fkey";
ALTER TABLE "cases" RENAME CONSTRAINT "cases_companyId_fkey"  TO "cases_company_id_fkey";
ALTER TABLE "cases" RENAME CONSTRAINT "cases_contactId_fkey"  TO "cases_contact_id_fkey";

-- Contract
ALTER TABLE "contracts" RENAME CONSTRAINT "contracts_companyId_fkey" TO "contracts_company_id_fkey";

-- CustomerSubscription
ALTER TABLE "customer_subscriptions" RENAME CONSTRAINT "customer_subscriptions_companyId_fkey" TO "customer_subscriptions_company_id_fkey";

-- Invoice
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_companyId_fkey" TO "invoices_company_id_fkey";
ALTER TABLE "invoices" RENAME CONSTRAINT "invoices_dealId_fkey"    TO "invoices_deal_id_fkey";

-- Lead
ALTER TABLE "leads" RENAME CONSTRAINT "leads_ownerId_fkey" TO "leads_owner_id_fkey";

-- Order
ALTER TABLE "orders" RENAME CONSTRAINT "orders_companyId_fkey" TO "orders_company_id_fkey";
ALTER TABLE "orders" RENAME CONSTRAINT "orders_quoteId_fkey"   TO "orders_quote_id_fkey";

-- PortalToken
ALTER TABLE "portal_tokens" RENAME CONSTRAINT "portal_tokens_clientId_fkey"  TO "portal_tokens_client_id_fkey";
ALTER TABLE "portal_tokens" RENAME CONSTRAINT "portal_tokens_companyId_fkey" TO "portal_tokens_company_id_fkey";

-- Project: also re-add the company FK with the schema-declared Restrict semantics.
ALTER TABLE "projects" RENAME CONSTRAINT "projects_dealId_fkey" TO "projects_deal_id_fkey";
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_companyId_fkey";
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_company_id_fkey";
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quote
ALTER TABLE "quotes" RENAME CONSTRAINT "quotes_dealId_fkey"    TO "quotes_deal_id_fkey";
ALTER TABLE "quotes" RENAME CONSTRAINT "quotes_invoiceId_fkey" TO "quotes_invoice_id_fkey";

-- SmsMessage
ALTER TABLE "sms_messages" RENAME CONSTRAINT "sms_messages_contactId_fkey" TO "sms_messages_contact_id_fkey";

-- SequenceEnrollment: re-add with SET NULL (schema-declared).
ALTER TABLE "sequence_enrollments" DROP CONSTRAINT IF EXISTS "sequence_enrollments_contactId_fkey";
ALTER TABLE "sequence_enrollments" DROP CONSTRAINT IF EXISTS "sequence_enrollments_contact_id_fkey";
ALTER TABLE "sequence_enrollments"
  ADD CONSTRAINT "sequence_enrollments_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EventAttendee: re-add both with SET NULL (schema-declared).
ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_contactId_fkey";
ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_contact_id_fkey";
ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_clientId_fkey";
ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_client_id_fkey";
ALTER TABLE "event_attendees"
  ADD CONSTRAINT "event_attendees_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "event_attendees"
  ADD CONSTRAINT "event_attendees_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
