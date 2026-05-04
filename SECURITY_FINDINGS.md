# SECURITY_FINDINGS.md

Last updated: 2026-05-04 00:31 Europe/Bucharest

Security status must be based on evidence, not impressions. Do not mark a finding fixed unless the fix and verification are documented.

## Severity Scale

- P0: exploitable data leak / auth bypass / tenant isolation break
- P1: serious security weakness
- P2: defense-in-depth / hardening
- P3: documentation/config risk

## Open Findings

| ID | Severity | Finding | Evidence | Risk | Fix plan | Status |
|---|---:|---|---|---|---|---|
| SEC-001 | P3 | Production security readiness is not verified. | Local checks only; no production env, stable domain, backup, monitoring, or real provider credentials verified. | Unknown launch security posture. | Run production-context security/release review after infra and credentials exist. | open |
| SEC-002 | P2 | Moderate dependency advisories remain in non-production audit output. | `pnpm audit --json` previously reported `vite` CVE-2026-39365, `esbuild` GHSA-67mh-4wv8-2f99, `postcss` CVE-2026-41305. | Dev/build-chain exposure should not be ignored. | Update affected dependency chain or controlled overrides; rerun audit and test suite. | open |
| SEC-003 | P3 | No local secret-scanner evidence exists. | `command -v gitleaks` unavailable in this environment. | Secrets may be missed if committed under unexpected names. | Install/use approved scanner or verify CI secret scanning. | open |
| SEC-004 | P1 | RLS policies are fail-open when tenant context is missing. | `BEGIN; SET LOCAL ROLE app_user; SELECT current_setting('app.tenant_id', true), count(*) FROM companies; ROLLBACK;` returned `122` companies with empty tenant setting. Policies include `current_tenant_id() IS NULL OR ...`. | If any app/query path runs as restricted DB role without tenant context, RLS does not protect tenant data. | Replace fail-open policies with deny-by-default tenant match; introduce explicit migration/test path for tenant-less auth lookups if needed. Add regression SQL test. | open |
| SEC-005 | P1 | Notifications Socket.IO gateway bypasses main CORS allow-list and reads wrong tenant claim. | `apps/api/src/modules/notifications/notifications.gateway.ts` uses `@WebSocketGateway({ cors: { origin: '*' }})`; `AuthService` JWT payload uses `tid`, gateway verifies `{ tenantId: string }`. | Wildcard WS origin weakens browser boundary; tenant room binding may be wrong, causing missed or misrouted realtime events. | Reuse `CORS_ALLOWED_ORIGINS`; verify token payload as `{ tid }`; add gateway unit/e2e test. | open |
| SEC-006 | P1 | AI worker manual `/process/call` can fetch arbitrary recording URLs after static bearer auth. | Unauth valid request returned `401`; source in `apps/ai-worker/app/main.py` protects with bearer, but `pipeline.py` follows redirects for caller-supplied `recordingUrl`. Docker maps worker on port `8000`. | If bearer leaks or endpoint is exposed, attacker can use worker for SSRF or large outbound downloads. | Restrict endpoint network exposure; add Twilio host allow-list/private-IP block/max redirect policy; consider disabling manual endpoint outside dev. | open |
| SEC-007 | P2 | `WEBHOOK_TRUSTED_HOSTS` is a production SSRF footgun. | `webhooks.service.ts` bypasses DNS/IP check if hostname is in env allow-list; `env.ts` documents dev-only but does not reject it in production. | Accidental prod config can bypass webhook SSRF protections. | Reject non-empty `WEBHOOK_TRUSTED_HOSTS` in production or rename to explicit dev-only env guarded by `NODE_ENV`. | open |
| SEC-008 | P3 | Webhook creation returns raw secret; policy needs explicit decision. | `webhooks.service.ts create()` selects `secret`; list/get/update use public select. | One-time display may be acceptable, but it conflicts with a stricter "never return secrets after creation" reading unless documented. | Decide policy. If one-time display is accepted, document and avoid returning on any later read; otherwise remove from create response and add rotate/reveal flow. | open |

## Fixed Findings

| ID | Severity | Finding | Fixed in commit | Verification |
|---|---:|---|---|---|

## Disproven / Controlled Findings

| ID | Claim | How it was checked | Result |
|---|---|---|---|
| DISP-001 | Authenticated API responses are cached by service worker. | Code inspection of `apps/web/public/sw.js`. | Disproven: `/api/` GET requests return before `respondWith`; SW does not cache API. |
| DISP-002 | Detailed health is public without auth. | `curl ... http://localhost:3000/api/v1/health/detailed` in this session. | Disproven locally: returned `401`. |
| DISP-003 | Metrics are public without auth. | Security explorer checked `curl http://localhost:3000/metrics`. | Disproven locally: returned `403`. |
| DISP-004 | Main HTTP CORS uses wildcard. | Code inspection of `apps/api/src/main.ts` and env validation. | Disproven for main API; exception is notifications gateway (`SEC-005`). |
| DISP-005 | Refresh token rotation is non-atomic. | Code inspection of `auth.service.ts` and existing tests. | Controlled: refresh uses guarded `updateMany`, revokes family on reuse/race, and e2e covers old token failure. |

## Required Security Checks Before Production

- [ ] RLS deny-by-default on tenant-scoped tables
- [x] no authenticated API cached by service worker
- [x] refresh token rotation checked in code/tests
- [ ] webhook secrets policy finalized
- [ ] webhook SSRF protection production footgun fixed
- [ ] WhatsApp/Meta webhook signature verified over raw body with current docs/real setup
- [ ] AI worker internal/manual endpoints protected and SSRF-hardened
- [ ] CORS restricted to real domains, including Socket.IO gateways
- [x] rate limiter behavior observed locally
- [ ] JWT secrets strong and rotated
- [ ] no secrets committed to Git verified by secret scanner

## Current Session Notes

- Browser smoke hit auth rate limiter with `429 Too Many Requests` during an early critical-smoke design; test was changed to avoid double login.
- Real provider behavior was not verified: Twilio, Stripe, Google OAuth, Microsoft Graph, Anthropic, SMTP, ANAF.
- Current findings are local/source-based unless explicitly marked production.
