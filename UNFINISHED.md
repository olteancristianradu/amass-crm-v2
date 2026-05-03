# UNFINISHED.md

Last updated: 2026-05-03 23:50 Europe/Bucharest

## P0 — Must fix before demo/launch

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P0-001 | Verify production/demo environment readiness. | Launch cannot be called ready without domain, HTTPS, env, secrets, migrations, health, backups, and monitoring. | open | Codex + human for credentials/infrastructure | `RELEASE_CHECKLIST.md` production readiness items remain unchecked. |
| P0-002 | Complete focused security audit for auth, tenant isolation, RLS, webhooks, service worker caching, secrets, exposed ops endpoints, and dependency hygiene. | These are the highest-risk areas for tenant data leaks and auth bypass. | in-progress | Codex | Partial checks: RLS local query, service worker code inspection, `/api/v1/health/detailed` 401, dependency audit. Full security scan not complete. |
| P0-003 | Verify launch-critical providers with real credentials. | Twilio, Stripe, Google, Microsoft, Anthropic, SMTP, and ANAF behavior cannot be honestly claimed from mocks alone. | blocked | human provides credentials; Codex verifies | No real provider credential tests were run in this session. |
| P0-004 | Run authenticated browser/manual smoke tests for auth, tenant CRUD, attachments, tasks, and reminders. | API e2e passing is useful, but launch/demo needs a browser/runtime path check too. | in-progress | Codex | API e2e passed (`105` files / `1086` tests); API Docker rebuilt/restarted and Cloudflare health returned `200`; browser/manual smoke not run. |
| P0-005 | Approve the AMASS Pro CRM product/design wedge before feature expansion. | A generic "more modules" CRM will not beat Salesforce/HubSpot/Pipedrive/Attio; the product needs a clear action-first wedge and first demo workflow. | open | human + Codex | Repo has strong modules, command palette, semantic search, AI/calls/ANAF positioning; next step is to select the first flagship workflow before implementation. |

## P1 — Important before production

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P1-001 | Run Docker-backed e2e tests under `apps/api/test/` if environment supports them. | Unit tests passed, but e2e coverage is needed for full API confidence. | done | Codex | `pnpm --filter @amass/api test:e2e` -> `105` files / `1086` tests passed. |
| P1-002 | Run Prisma migration/drift verification. | Schema drift has broken CI before and can break deployments. | done | Codex | `prisma migrate deploy` had no pending migrations; `prisma migrate diff ... --exit-code` reported no difference detected. |
| P1-003 | Reconcile old `LAUNCH_CHECKLIST.md` with `RELEASE_CHECKLIST.md`. | Two launch checklists can diverge and mislead release decisions. | open | Codex | `rg --files -g '*.md'` shows both files. |
| P1-004 | Verify current CI after the next push. | Existing CI is green for `d325637`, but docs are currently uncommitted and no new CI run exists for them. | open | Codex | `gh run list --limit 5` checked previous `main` run only. |
| P1-005 | Fix or explicitly accept moderate dependency advisories. | `vite`, `esbuild`, and `postcss` advisories remain in non-production audit output. | open | Codex | `pnpm audit --json` reported 3 moderate advisories; `pnpm audit --prod --audit-level=high` passed. |
| P1-006 | Add local secrets scanner or document CI-only coverage. | Local `gitleaks` was unavailable, so no local secret scan evidence exists. | open | Codex | `command -v gitleaks` exit `1`; GitHub CodeQL success does not equal secret scan. |
| P1-007 | Design and build AMASS Pro Cockpit + Focus Queue. | The CRM should start with prioritized work, not passive dashboards and route navigation. | open | Codex | Current dashboard has AI brief/KPIs/pipeline foundation in `apps/web/src/routes/dashboard.tsx`. |
| P1-008 | Redesign Entity 360 pages around timeline, next action, relationship graph, and audit-safe AI suggestions. | Users should understand and act on a customer record in seconds. | open | Codex | Existing modules cover companies/contacts/clients/deals/tasks/reminders; workflow needs consolidation into one action surface. |
| P1-009 | Upgrade Command Palette into a safe action engine. | Cmd/Ctrl+K is already a differentiator; it should create/update/search with confirmation, permissions, and audit trail. | open | Codex | Existing global palette and `/ai/search` integration are in `apps/web/src/components/ui/command-palette.tsx` and `apps/web/src/features/search/api.ts`. |
| P1-010 | Establish UX performance budgets and browser smoke automation. | "Faster than large CRMs" needs measured latency and interaction targets, not opinion. | open | Codex | No browser/UI smoke or p95 route performance checks were run in this session. |

## P2 — Polish / post-launch

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P2-001 | Keep root control docs concise and current. | Long historical status blocks obscure the current truth. | in-progress | Codex | `STATUS.md` was converted to current-session format. |
| P2-002 | Add browser-based UI smoke coverage for critical pages. | HTTP 200 on web root does not prove the UI is usable. | open | Codex | No browser or Playwright UI smoke was run in this session. |
| P2-003 | Add Romania/EU vertical packs for sales + service + invoicing workflows. | Local compliance and ANAF/e-Factura can be a defensible wedge against generic global CRMs. | open | Codex + human domain input | Existing product copy already positions ANAF/e-Factura and RO/EU CRM behavior. |
| P2-004 | Build integration marketplace and mobile/offline follow-up flows. | Long-term expansion needs channels and field-sales workflows beyond desktop CRM. | open | Codex | Not started. |

## Blocked

| Task | Blocker | What is needed |
|---|---|---|
| Twilio calls/SMS/WhatsApp | missing real SID/token/phone number/webhook setup | user must provide safe real/test credentials and callback URL |
| Google OAuth | missing client ID/secret/redirect setup | user must configure OAuth app and provide test account path |
| Microsoft Graph | missing app credentials/scopes/test mailbox | user must configure app registration and provide test account path |
| Stripe live billing | missing real keys/webhook secret | user must provide safe Stripe test/live setup depending on launch scope |
| Anthropic AI features | missing real API key | user must provide key or accept fallback-only verification |
| SMTP real email | missing real SMTP credentials | user must provide SMTP host/user/password/from-domain and test recipient |
| ANAF e-Factura | missing real/sandbox OAuth credentials and tenant fiscal data | user must provide ANAF credentials and safe test tenant data |
