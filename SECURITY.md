# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue.** Email `cristian.raduoltean@gmail.com` with:

- Description of the issue
- Steps to reproduce
- Affected component (API/web/AI worker/infra)
- Your assessment of severity

We aim to respond within 7 days. Critical issues (auth bypass, tenant data leak, RCE) get a same-day acknowledgement.

## Supported versions

Only `main` is supported. There is no LTS branch yet.

## Security practices in this project

- **Multi-tenancy**: 3-layer enforcement (middleware + Prisma extension + Postgres RLS deny-by-default).
- **Auth**: JWT 15-min access tokens + 30-day refresh with rotation and reuse detection. TOTP 2FA available.
- **Secrets**: Zod env validation at boot, fail-fast on missing values. `gitleaks` runs on every push and weekly.
- **Dependencies**: `pnpm audit --prod --audit-level=high` runs in CI; HIGH/CRITICAL advisories fail the build.
- **Static analysis**: GitHub CodeQL on every push and weekly schedule.
- **PII**: Romanian CNP, IBAN, phone, email all redacted in logs by default (Pino redaction config).
- **Webhook URLs**: SSRF-validated with DNS rebinding protection (resolved IP pinned at delivery time, no `fetch()` for untrusted URLs).
- **AI worker**: Bearer-authenticated, recording URL host allow-list, refuses non-public IP resolution.

Open security findings live in [`SECURITY_FINDINGS.md`](./SECURITY_FINDINGS.md).

## Disclosure

After a fix is merged, we publish:
- A `SEC-N` tracker entry in [`SECURITY_FINDINGS.md`](./SECURITY_FINDINGS.md) under "Fixed Findings"
- The commit SHA where the fix landed
- Verification evidence (test output, manual repro)

Reporters are credited in the security advisory unless they request anonymity.
