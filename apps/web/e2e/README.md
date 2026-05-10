# Browser smoke / e2e tests

Playwright tests against a live stack (local Docker compose or a deployed URL).

## Available smokes

| File | What it covers | Auth needed? |
|---|---|---|
| `pwa-smoke.e2e.ts` | Manifest + icons + SW + robots.txt + meta tags reachable | No |
| `auth-smoke.e2e.ts` | Login → dashboard navigation | Yes |
| `cockpit-smoke.e2e.ts` | Cockpit page renders + drag-drop layout persists | Yes |
| `critical-crm-smoke.e2e.ts` | Create company → upload → task → reminder full flow | Yes |

## How to run

### Against local docker-compose

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @amass/web e2e
```

### Against a deployed URL (CI / canary)

```bash
PLAYWRIGHT_BASE_URL=https://crm.example.com \
SMOKE_EMAIL=ops@amass.ro \
SMOKE_PASSWORD=*** \
SMOKE_TENANT_SLUG=amass \
pnpm --filter @amass/web e2e:smoke
```

### Just the no-auth smokes (deploy verification)

```bash
PLAYWRIGHT_BASE_URL=https://crm.example.com \
pnpm --filter @amass/web e2e pwa-smoke
```

## Required env vars

| Var | When required | Purpose |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | Always | Where to point the browser (default: `http://localhost`) |
| `SMOKE_EMAIL` | auth/cockpit/critical | Login email for the test account |
| `SMOKE_PASSWORD` | auth/cockpit/critical | Login password |
| `SMOKE_TENANT_SLUG` | When the email belongs to multiple tenants | Picks the right tenant on the login picker |

Tests skip themselves (with a clear message in the report) when their required
envs are missing — so `pnpm e2e` against a deploy that has no test account
still passes the no-auth smokes.

## Adding a new smoke

1. Drop `<name>-smoke.e2e.ts` in this directory.
2. Use `test.skip(!hasCreds, '...')` if it needs auth.
3. Keep it fast (< 30s) — these run on every deploy.
4. Reuse helpers from `critical-crm-smoke.e2e.ts` (apiLogin / dismissCookieBanner).
