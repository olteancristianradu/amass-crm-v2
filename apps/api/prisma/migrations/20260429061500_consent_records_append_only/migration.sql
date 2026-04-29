-- Append-only enforcement at DB layer for consent_records.
-- The previous migration created the table + RLS + GRANT SELECT, INSERT, but a
-- global default GRANT on schema (or pattern-consistency migration) may have
-- given app_user UPDATE/DELETE/TRUNCATE. Revoke explicitly so even a buggy
-- direct query cannot mutate consent history — required for GDPR Art. 7(1)
-- "controller shall be able to demonstrate that the data subject has consented".
--
-- Pattern matches audit_logs (M-aud-M7 in 20260428110000_audit_append_only_and_sso_encrypt).
-- Revocation of a consent = INSERT new row with status=REVOKED, NEVER UPDATE.

REVOKE UPDATE, DELETE, TRUNCATE ON "consent_records" FROM app_user;
