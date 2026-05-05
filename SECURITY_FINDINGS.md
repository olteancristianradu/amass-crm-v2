# SECURITY_FINDINGS.md

Last updated: 2026-05-05 14:50 Europe/Bucharest

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
| SEC-002 | P2 | Moderate dependency advisories remain in non-production audit output. | `pnpm audit --json` previously reported `vite` CVE-2026-39365, `esbuild` GHSA-67mh-4wv8-2f99, `postcss` CVE-2026-41305. | Dev/build-chain exposure should not be ignored. | Update affected dependency chain or controlled overrides; rerun audit and test suite. | open (dev-only — high/critical resolved 2026-05-05) |
| SEC-AXIOS-PROTO-POLLUTION | P1 | 4 HIGH advisories in `axios@1.15.0` (proto-pollution gadgets, header injection, NO_PROXY bypass) reachable via `twilio@5.13.1`. | `<pending-commit-after-this-edit>` (2026-05-05) | Added `pnpm.overrides.axios: ">=1.15.2"` in root `package.json`; resolved to `axios@1.16.0`. Verified `pnpm audit --prod --audit-level=high` → "No known vulnerabilities found". API 983/983, web 52/52 still pass. CI's `dependency-audit` job blocked all pushes from this session until this fix. |
| SEC-003 | P3 | No local secret-scanner evidence exists. | `command -v gitleaks` unavailable in this environment. | Secrets may be missed if committed under unexpected names. | Install/use approved scanner or verify CI secret scanning. | open |
| SEC-004 | P1 | RLS policies are fail-open when tenant context is missing. | `BEGIN; SET LOCAL ROLE app_user; SELECT current_setting('app.tenant_id', true), count(*) FROM companies; ROLLBACK;` returned `122` companies with empty tenant setting. Policies include `current_tenant_id() IS NULL OR ...`. | If any app/query path runs as restricted DB role without tenant context, RLS does not protect tenant data. | Replace fail-open policies with deny-by-default tenant match; introduce explicit migration/test path for tenant-less auth lookups if needed. Add regression SQL test. | open |

## Fixed Findings

| ID | Severity | Finding | Fixed in commit | Verification |
|---|---:|---|---|---|
| SEC-006 | P1 | AI worker manual `/process/call` can fetch arbitrary recording URLs after static bearer auth. | `25f096b` (auth gate, 2026-05-03) + `<pending>` (SSRF allow-list + private-IP block, 2026-05-05) | `apps/ai-worker/app/main.py` requires `Authorization: Bearer ${AI_WORKER_SECRET}` (fail-fast 503 if empty). `apps/ai-worker/app/pipeline.py` `_is_recording_url_safe()` now: (1) refuses non-HTTPS, (2) requires hostname match against `RECORDING_ALLOWED_HOSTS` (default `.twilio.com,api.twilio.com,api.twiliocdn.com,media.twiliocdn.com`), (3) refuses if any resolved IP is private/loopback/link-local/multicast/reserved/unspecified — defends against DNS rebinding to cloud metadata (`169.254.169.254`). Residual: httpx still follows redirects up to default; redirect-target re-validation deferred (P2). |
| SEC-WEBHOOK-SSRF-DNS-REBIND | P2 | Webhook delivery used `fetch()` after URL validation, leaving a TOCTOU window for DNS rebinding. | `25f096b` (2026-05-03) | `apps/api/src/modules/webhooks/webhooks.service.ts` now pins resolved IP (`pinnedAddress`) and posts via `node:http`/`node:https` `request()` against the pinned address. `[verificat 2026-05-05: git show 25f096b]`. |
| SEC-004 | P1 | RLS policies were fail-open when tenant context was missing. | `4415c21` (`fix(security): SEC-004 RLS deny-by-default when tenant context is missing`, 2026-05-05) | Migration `20260504065000_rls_deny_missing_tenant` rewrites `current_tenant_id()` to return a sentinel instead of NULL, so the legacy `current_tenant_id() IS NULL OR ...` branch is false when `app.tenant_id` is unset. Verified `[verificat]`: `BEGIN; SET LOCAL ROLE app_user; SELECT count(*) FROM companies; ROLLBACK;` → `0`. Regression in `apps/api/test/multi-tenant.e2e.spec.ts` (`pnpm exec vitest run test/multi-tenant.e2e.spec.ts` → 7/7 pass). |
| SEC-005 | P1 | Notifications Socket.IO gateway bypassed main CORS allow-list and read wrong tenant claim. | `2c2a68a` (2026-05-05) | `apps/api/src/modules/notifications/notifications.gateway.ts` now uses `CORS_ALLOWED_ORIGINS` from env (no wildcard in prod, env-validated) and reads `payload.tid` to match `AuthService.signAsync`. Regression in `apps/api/src/modules/notifications/notifications.gateway.spec.ts` covers happy path, missing token, invalid signature. Local: `vitest run notifications.gateway.spec.ts` → 3/3 pass. |
| SEC-007 | P2 | `WEBHOOK_TRUSTED_HOSTS` was a production SSRF footgun: dev escape hatch left set in prod would bypass DNS/IP rebind check. | `6a6fc4c` (2026-05-05) | `apps/api/src/config/env.ts` `prodOnlyChecks` now rejects any non-empty `WEBHOOK_TRUSTED_HOSTS` when `NODE_ENV=production`. Regression in `apps/api/src/config/env.prod-checks.spec.ts` (4 tests). Local: full API suite 980/980 pass. |
| SEC-008 | P3 | Webhook secret was returned at create with no documented rotation path. | `<pending-commit-after-this-edit>` (2026-05-05) | Policy is now: secret is returned **once** at `POST /webhooks/endpoints` (one-time display); list/get/update never return it; new endpoint `POST /webhooks/endpoints/:id/rotate-secret` regenerates and returns the new secret once. Audit logs the rotation. Tests in `webhooks.service.spec.ts` (3 new tests, 47 total). |

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
