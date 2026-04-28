-- M-aud-onDelete part 2: rest of the 22 business cross-references
-- documented in UNFINISHED.md. Strategy mapping is tested here against
-- the actual is_nullable of each column (see audit query 2026-04-28):
--   • required column + parent of legal/audit interest → RESTRICT
--   • required column + tightly-coupled child rows  → CASCADE
--   • optional column                                → SET NULL
--
-- Pattern from migration 20260428130000 — additive only, the application
-- code already filters by tenantId + deletedAt so this is a free
-- correctness lift. Failed ALTER TABLE here would mean dangling rows
-- exist (none expected — every service writes through runWithTenant).

-- ── Deals (owner only — companyId/contactId already added in prev migration)
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Invoices.dealId (companyId already added in prev migration)
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_dealId_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Projects (both nullable in schema)
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_dealId_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Quotes (note: quotes_company_id_fkey already exists per the audit
-- of pg_constraint; only add the dealId + invoiceId references here)
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_dealId_fkey"
  FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_invoiceId_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── SequenceEnrollment (Cascade — enrollments mean nothing without the contact)
ALTER TABLE "sequence_enrollments"
  ADD CONSTRAINT "sequence_enrollments_contactId_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ApprovalRequest.quoteId (NOT NULL → Cascade)
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_quoteId_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AnafSubmission.invoiceId (Cascade — submission is per-invoice, no orphan)
ALTER TABLE "anaf_submissions"
  ADD CONSTRAINT "anaf_submissions_invoiceId_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PortalToken (both Cascade — magic links are useless without target)
ALTER TABLE "portal_tokens"
  ADD CONSTRAINT "portal_tokens_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_tokens"
  ADD CONSTRAINT "portal_tokens_clientId_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── SmsMessage.contactId (optional — SetNull keeps history)
ALTER TABLE "sms_messages"
  ADD CONSTRAINT "sms_messages_contactId_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Lead.ownerId (optional — SetNull on user delete)
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_ownerId_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Contract.companyId (NOT NULL + legal preservation → Restrict)
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CustomerSubscription.companyId (NOT NULL + revenue tracking → Restrict)
ALTER TABLE "customer_subscriptions"
  ADD CONSTRAINT "customer_subscriptions_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Cases (all 3 nullable → SetNull)
ALTER TABLE "cases"
  ADD CONSTRAINT "cases_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cases"
  ADD CONSTRAINT "cases_contactId_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cases"
  ADD CONSTRAINT "cases_assigneeId_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Orders
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_companyId_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_quoteId_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── EventAttendee (both nullable but Cascade because attendee has no
-- meaning without the linked person)
ALTER TABLE "event_attendees"
  ADD CONSTRAINT "event_attendees_contactId_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_attendees"
  ADD CONSTRAINT "event_attendees_clientId_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
