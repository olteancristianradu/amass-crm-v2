# Changelog

All notable changes to AMASS CRM are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Security

- SEC-004: RLS deny-by-default when tenant context is missing — migration `20260504065000_rls_deny_missing_tenant` (`4415c21`)
- SEC-005: Notifications Socket.IO gateway uses `CORS_ALLOWED_ORIGINS` and reads `payload.tid` (was `payload.tenantId`) (`2c2a68a`)
- SEC-006 (auth gate): AI worker `/process/call` now requires `Authorization: Bearer ${AI_WORKER_SECRET}` (`25f096b`)
- SEC-006 (residual): `_is_recording_url_safe()` enforces HTTPS, host allow-list, public-IP-only resolution (`a6bcc5a`)
- SEC-007: `WEBHOOK_TRUSTED_HOSTS` rejected in production via `prodOnlyChecks` (`6a6fc4c`)
- SEC-008: Webhook secret rotation endpoint `POST /webhooks/endpoints/:id/rotate-secret` with one-time-display policy (`a9fca1a`)
- Webhooks: DNS-rebinding protection via IP pinning at delivery time (`25f096b`)
- Dependencies: axios pinned to ≥1.15.2 to close 4 HIGH CVEs reachable via `twilio` (`63628e9`)
- CI: gitleaks secret-scan workflow on every push, PR, and weekly schedule (`855f241`)

### Added

- Microsoft Graph email integration (Outlook OAuth)
- Polymorphic tag system across companies/contacts/clients/deals/leads
- Cloudflare quick tunnel for live demo
- Critical CRM browser smoke (Playwright) covering company create, attachment upload + presigned download with byte comparison, task complete, reminder dismiss

### Changed

- LAUNCH_CHECKLIST.md marked DEPRECATED; RELEASE_CHECKLIST.md is now the single authoritative launch gate
- Standalone tasks (no deal, no subject) are now allowed (created from `/tasks` page)
- All unsafe `Zod.parse()` calls replaced with `safeParse()` + `BadRequestException`
- MinIO presigned URLs now use a separate `presignClient` so URLs reach the browser through Caddy's `/amass-files/*` proxy

### Fixed

- Tasks: `assertExactlyOneLink` no longer rejects standalone tasks
- MinIO: presigned URLs no longer contain Docker-internal hostname

## Earlier history

The project shipped in sprints S0–S55 between September 2025 and April 2026. Notable milestones:

- **S0–S2**: NestJS + Prisma skeleton, multi-tenant auth, RLS, audit log
- **S3–S6**: Companies, Contacts, Clients (B2B/B2C), Notes timeline, Attachments via MinIO
- **S7–S10**: Reminders + BullMQ, frontend skeleton + detail pages, Pipelines/Deals/Tasks
- **S11–S14**: Email + tracking, Calls (Twilio), AI worker (Whisper + Presidio + Claude pipeline)
- **S15–S20**: Workflows + sequences, Reports, GDPR, observability, Railway deploy, polish
- **S30–S35**: Quotes, email sequences, contact segments, deal forecast, Swagger/OpenAPI
- **S36–S40**: Custom fields, approvals, duplicates dedup, products, SSO/SAML
- **S41–S46**: WhatsApp, ANAF e-Factura, Calendar, Report Builder, Lead Scoring, Client Portal
- **S47–S52**: Notifications, Export, SMS, Webhooks, Billing (Stripe), AI Enrichment
- **S53–S55**: Leads, Contracts, Forecasting

Detailed sprint notes and security findings: [`docs/`](./docs/) and [`SECURITY_FINDINGS.md`](./SECURITY_FINDINGS.md).
