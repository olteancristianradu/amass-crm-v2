-- Enforce globally unique phone numbers so a Twilio webhook
-- can never be routed to the wrong tenant via a findFirst() ambiguity.
-- If duplicates exist (shouldn't in practice), this migration will fail
-- and require manual cleanup before re-applying.
CREATE UNIQUE INDEX "phone_numbers_number_key" ON "phone_numbers"("number");
