-- S26: 2FA/TOTP support.
-- totp_secret stores the base32-encoded secret, encrypted at rest with
-- the same AES-256-GCM key used for SMTP passwords (ENCRYPTION_KEY env var).
-- totp_enabled is false until the user completes the TOTP setup flow
-- (scans QR, verifies first code) so half-setup accounts are not affected.

ALTER TABLE "users"
    ADD COLUMN "totp_secret"  TEXT,
    ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT FALSE;
