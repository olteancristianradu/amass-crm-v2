# Changelog

All notable changes to AMASS CRM are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added (2026-05-10 / 2026-05-11 — D-task sweep)

- **Entity 360 relationship health** (`feat(entity360)` `13faa8c`): new `/entity-health/:type/:id` endpoint returning a 0–100 score, per-signal breakdown, and a Romanian one-sentence summary. New `RelationshipHealthCard` (SVG dial + 4 signal tiles) mounted on company/contact/client detail pages. No LLM calls on the hot path.
- **Command Palette quick actions** (`feat(cmdk)` `83b3a8a`): three new "Acțiuni rapide" — Adaugă task / Înregistrează apel / Trimite email — open inline confirmation forms inside the Cmd-K modal; audit log entries are created automatically by the underlying controllers.
- **GestCom PDF importer** (`feat(importer)` `38b265f`): adapter for `gestcom.ro/<tenant>/lucrari` PDF exports. Splits the table-row anchor, extracts contact identity (Nume/Prenume/Email/Telefon/Oras/Suprafata) plus GestCom-specific metadata (situatie, judet, stadiu, data_decizie, observatii). Activates only when filename contains `gestcom|lucrari|amass-export`. Also fixes a hidden `pdf-parse` v2 API breaking change in the generic `PdfAdapter`.
- **Illustrated EmptyState** (`feat(ui)` `cb427c4`): 3 inline-SVG variants (`empty-list` / `no-results` / `error`) replace the icon badge on companies, contacts, clients list pages.
- **Bundle analyzer** (`chore(web)` `bf7dab2`): `pnpm build:analyze` (or `ANALYZE=1 vite build`) produces `dist/stats.html` via rollup-plugin-visualizer.
- **PWA browser smoke** (`test(web)` `a036948`): `pwa-smoke.e2e.ts` verifies manifest + icons + sw.js + robots.txt + meta tags on any deployed URL. `pnpm e2e:smoke` runs only the smoke files. Docs in `apps/web/e2e/README.md`.
- **Service worker unit test** (`test(web)` `3f81d96`): runs `public/sw.js` in a vm sandbox with mocked Cache API to verify the 4 routing rules (cache-first assets, network-first HTML, network-only `/api/*`, CLEAR_CACHES logout flow).
- **+20 unit specs** (`test(api)` `12055bf`): `OutlookEmailService` (OAuth CSRF/replay defenses), `ai/SearchService`, `JwtAuthGuard` (NO_TOKEN / INVALID_TOKEN / TOKEN_REVOKED / TENANT_SUSPENDED paths). Suite total now **1087** API tests across 108 files.

### Changed (2026-05-10 / 2026-05-11)

- **Onboarding wizard copy** (`feat(ui)` `5c2f453`): replaced dev jargon (RLS / Cedar / Whisper / Presidio / UBL) with plain-Romanian user benefits across all 4 wizard steps.
- **Cockpit drag-drop polish** (`feat(ui)` `0bc0d73`): scale + shadow + cyan glow on drag and drop targets; grip handle highlights when grabbed.
- **A11y** (`feat(a11y)` `a587b30`): skip-to-content link, `<main id="main-content">`, `aria-label` on sidebar, `role="menu"` on UserMenu dropdown.
- **Favicon + SEO** (`feat(web)` `f93d16f`): voice-wave accent on the `A` mark, OpenGraph + Twitter meta tags, `lang="ro"`, `robots.txt`.
- **Docs hygiene** (2026-05-11): removed point-in-time snapshot files (`STATUS.md`, `TEST_REPORT.md`, `UNFINISHED.md`, `docs/UNFINISHED.md`, `docs/SESSION_REPORT_2026-04-28.md`, `docs/VERIFICATION_REPORT_2026-04-28.md`, `LAUNCH_CHECKLIST.md`). `CHANGELOG.md` + `git log` are the cross-session history; `RELEASE_CHECKLIST.md` is the live launch gate. Agent prompts (`AGENTS.md`, `agents/*.md`) updated to match.

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
