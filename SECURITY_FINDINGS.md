# SECURITY_FINDINGS.md

Last updated: 2026-05-03 23:10 Europe/Bucharest

Security status must be based on evidence, not impressions. Do not mark a finding fixed unless the fix and verification are documented.

## Severity scale

- P0: exploitable data leak / auth bypass / tenant isolation break
- P1: serious security weakness
- P2: defense-in-depth / hardening
- P3: documentation/config risk

## Open findings

| ID | Severity | Finding | Evidence | Risk | Fix plan | Status |
|---|---:|---|---|---|---|---|
| SEC-001 | P3 | Production security readiness is not verified in this session. | Local-only checks were run; no production/demo URL, production env, real provider credentials, backup, or monitoring checks were run. | Unknown launch security posture until production context is checked. | Run focused production security review for auth, tenant isolation, RLS, webhooks, secrets, exposed ops endpoints, CORS, rate limits, and provider callbacks. | open |
| SEC-002 | P2 | Moderate dependency advisories remain in non-production audit output. | `pnpm audit --json` exited `1`: `vite` CVE-2026-39365, `esbuild` GHSA-67mh-4wv8-2f99, `postcss` CVE-2026-41305. `pnpm audit --prod --audit-level=high` passed. | Mostly dev/tooling exposure based on current audit scope, but dev-server and build-chain vulnerabilities should not be ignored. | Update affected dependency chain or add controlled overrides, then rerun `pnpm audit`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and relevant builds. | open |
| SEC-003 | P3 | No local secret-scanner evidence exists in this session. | `command -v gitleaks` returned exit `1`; local `.env` is ignored/untracked, but no local gitleaks scan was run. | Secrets may be missed by local review if committed under unexpected names. | Install/use an approved secret scanner or rely on documented CI secret scanning if configured and verified. | open |

## Fixed findings

| ID | Severity | Finding | Fixed in commit | Verification |
|---|---:|---|---|---|

## Disproven findings

| ID | Claim | How it was checked | Result |
|---|---|---|---|
| DISP-001 | Authenticated API responses are cached by the service worker. | Code inspection: `sed -n '1,140p' apps/web/public/sw.js`. | Disproven for current code: `/api/` GET requests return before `respondWith`, so the SW does not cache them. |
| DISP-002 | Detailed health is public without auth. | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/v1/health/detailed`. | Disproven in local runtime: returned `401` without token. |
| DISP-003 | Local public tenant-scoped tables lack RLS by default. | `docker exec amass-postgres psql ...` listed non-RLS public tables. | Local check found `83/87` public tables with RLS enabled/forced; the four non-RLS tables were `_prisma_migrations`, `email_verification_tokens`, `password_reset_tokens`, `tenants`. Production not checked. |

## Required security checks before production

- [x] RLS enabled/forced on tenant-scoped tables in local DB
- [x] no authenticated API cached by service worker
- [ ] refresh token rotation atomic
- [ ] webhook secrets never returned after creation
- [ ] webhook SSRF protection checked
- [ ] WhatsApp/Meta webhook signature verified over raw body
- [ ] AI worker internal/manual endpoints protected
- [ ] CORS restricted to real domains
- [ ] rate limiter verified
- [ ] JWT secrets strong and rotated
- [ ] no secrets committed to Git

## Current session notes

- No full security scan has been run yet in this session.
- `GET /api/v1/health/detailed` returned HTTP 401 without a token on 2026-05-03, which verifies it is not public in the currently running local API.
- Local RLS state was checked on 2026-05-03: `83` public tables had RLS enabled and forced; non-RLS public tables were `_prisma_migrations`, `email_verification_tokens`, `password_reset_tokens`, and `tenants`.
- Service worker API caching was checked by reading `apps/web/public/sw.js`; `/api/` requests are network-only in current code.
- `pnpm audit --prod --audit-level=high` passed, but full audit still reports moderate dev/transitive advisories in `vite`, `esbuild`, and `postcss`.
- `AI_WORKER_SECRET` callback protection is covered by `test/calls.e2e.spec.ts`: correct secret returns 200, wrong secret returns 403. Broader internal/manual endpoint protection remains to audit.
- Local `.env` is ignored/untracked (`git ls-files .env .env.example` listed only `.env.example`; `git check-ignore -v .env` matched `.gitignore`), but no local gitleaks scan was run because `gitleaks` is not installed.
- Credential-dependent providers remain unverified with real credentials unless separately documented: Twilio, Stripe, Google OAuth, Microsoft Graph, Anthropic, SMTP, ANAF.
