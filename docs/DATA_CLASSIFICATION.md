# Data Classification

Per SOC 2 CC6.7 + GDPR Art. 32: protect data based on its sensitivity.

Last updated: 2026-04-29 · v1.0

## Classification tiers

### RESTRICTED — breach = legal liability + reputational catastrophe
- Authentication secrets: passwords (bcrypt-hashed in DB), TOTP seeds (AES-256-GCM at rest), backup codes (SHA-256 hashed)
- Payment data: handled by Stripe (PCI scope) — we never store card numbers
- Sensitive personal data subject to special category (Art. 9 GDPR): voice content (potentially), medical/political/religious if disclosed in notes
- **CNP (Cod Numeric Personal — Romanian national ID, 13 digits)**:
  Romanian Law 506/2004 + Law 363/2018 require enhanced protection. Treated
  as RESTRICTED. Detection: regex `\b[1-9]\d{12}\b` with checksum validation.
  Storage: never log; encrypt with ENCRYPTION_KEY when stored; redact in
  AI worker via Presidio-RO ruleset (or fallback regex when Presidio not
  installed). Currently visible in: Contact.notes, Call transcripts (auto-
  redacted before storage), invoice PDF customer block (legitimate fiscal
  use under ANAF mandate).
- **IBAN (Romanian + EU bank account)**: financial data, breach risk for
  fraud. Treated as RESTRICTED. Detection: regex `[A-Z]{2}\d{2}[A-Z0-9]{4,30}`
  with mod-97 checksum. Storage: never log; redact in AI summaries; audit
  every access. Currently in: invoice payment metadata, supplier records.
- Production database credentials, JWT signing key, encryption keys
- Data subject access request payloads

### CONFIDENTIAL — breach = business + legal damage
- API keys for sub-processors (Anthropic, Twilio, Stripe webhook secrets) — at-rest encrypted via ENCRYPTION_KEY (AES-256-GCM)
- OAuth tokens (Google Calendar, etc.) — at-rest encrypted
- SAML certificates and SP private keys
- Customer business data: contacts, deals, deal values, win/loss analysis, internal notes
- Audit log content (who did what, when)
- Email content (in/out via tracking)
- Call recordings + transcripts
- Tenant-specific config: SIEM webhook URL, retention overrides

### INTERNAL — breach = embarrassment but no legal/financial harm
- System logs (Pino structured, redacted of PII via field-level rules)
- Application metrics (Prometheus)
- Performance dashboards
- Error stack traces (sanitized of secrets)
- Workflow definitions (logic, not data)

### PUBLIC — meant for the world
- Marketing landing pages
- /pricing page
- /privacy + /legal/subprocessors
- Public API documentation (when published)
- Open-source dependencies (package.json)

## Storage and protection per tier

| Tier | At rest | In transit | Backup | Retention |
|---|---|---|---|---|
| RESTRICTED | Application-level encryption (AES-256-GCM) on top of disk encryption | TLS 1.3 only | Encrypted backup with separate key | 10 years for fiscal; rest as required |
| CONFIDENTIAL | Disk encryption + RLS isolation | TLS 1.3 | Encrypted backup | Per tenant config (default 365d audit, 90d voice, contract-life contacts) |
| INTERNAL | Disk encryption | TLS 1.3 | Encrypted backup | 30-90 days |
| PUBLIC | Plain | TLS preferred | Versioned (git) | Forever |

## Field-level protections (in code)

| Field | Model | Protection |
|---|---|---|
| User.passwordHash | User | bcrypt cost=10 |
| User.totpSecret | User | AES-256-GCM @ rest via ENCRYPTION_KEY |
| User.totpBackupCodes | User | SHA-256 hashed array |
| Tenant.siemWebhookUrl | Tenant | plaintext (not sensitive) |
| SsoConfig.idpCertificateEnc | SsoConfig | AES-256-GCM (despite SSO disabled in this build) |
| SsoConfig.spPrivateKeyEnc | SsoConfig | AES-256-GCM |
| EmailIntegration.smtpPassword | EmailIntegration | AES-256-GCM |
| WhatsappAccount.accessToken | WhatsappAccount | AES-256-GCM |
| OAuthIntegration.refreshToken | OAuthIntegration | AES-256-GCM |
| ConsentRecord.* | ConsentRecord | RLS-isolated; append-only at DB layer (REVOKE UPDATE/DELETE) |
| Call.recordingUrl | Call | URL is transient (S3 presigned 15min); recordings on MinIO with bucket policy |
| Contact.notes / Lead.notes / Client.notes | various | redacted by AI worker before LLM submission; CNP/IBAN redacted via Presidio-RO ruleset |
| CallTranscript.redactedText | CallTranscript | post-redaction artifact (CNP, IBAN, phones, emails black-pilled) |
| Invoice.notes / customer block | Invoice | CNP+IBAN appear by fiscal mandate (ANAF e-Factura UBL 2.1); cannot redact, must encrypt at rest |

## Data retention enforcement

Per CLAUDE.md regula #12: binaries → MinIO. DB stores only `storageKey` + metadata.

Active retention policies:
- Audit log: configurable per tenant (default 365 days). Pruned by GdprService.pruneAuditLogsForTenant() — scheduled daily.
- Email tracks: 90 days (default). Pruned by EmailTrackingService.
- Voice recordings: 90 days. Pruned by CallsService.
- Soft-deleted contacts/companies: anonymized but kept for fiscal years (10y).

## Cross-border transfer

| Sub-processor | Region | Data tier transferred | Mechanism |
|---|---|---|---|
| Anthropic | US | CONFIDENTIAL (call transcripts, email content) | EU SCC 2021/914 + ToS no-train clause |
| Google Gemini | US | CONFIDENTIAL (same as above) | EU SCC + ToS |
| OpenAI | US | INTERNAL (text vectors, no PII) | EU SCC |
| Twilio | US/EU | CONFIDENTIAL (phone, recordings) | EU SCC |
| Stripe | US/IE | RESTRICTED (payment) — but PCI scope on Stripe side | EU SCC + PCI DSS |
| Cloudflare | Global edge | INTERNAL (request metadata) | EU SCC, EU edge preferred |
| Railway | EU (Frankfurt/Amsterdam) | All tiers (host) | No transfer (EU resident) |

See /legal/subprocessors for the up-to-date public version.
