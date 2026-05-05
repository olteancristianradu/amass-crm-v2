# UNFINISHED.md

Last updated: 2026-05-05 21:50 Europe/Bucharest

## P0 — Must Fix Before Demo/Launch

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P0-001 | Verify production/demo environment readiness. | Launch cannot be called ready without stable domain, HTTPS, env, secrets, migrations, backups, monitoring, and provider checks. | open | Codex + human | `RELEASE_CHECKLIST.md` production items remain unchecked. |
| P0-002 | Fix RLS fail-open policy when tenant context is missing. | RLS should be the last line of tenant isolation defense. | **fixed `4415c21` 2026-05-05** | Codex + Claude | Migration `20260504065000_rls_deny_missing_tenant`; e2e regression 7/7; DB SET LOCAL ROLE returns 0. |
| P0-003 | Fix notifications Socket.IO CORS and JWT tenant payload mismatch. | Realtime notifications should not accept wildcard origins and should join the correct tenant room. | **fixed 2026-05-05 (pending push)** | Claude | `SEC-005`; gateway now uses `CORS_ALLOWED_ORIGINS` and `payload.tid`; 3 unit tests cover happy/missing-token/bad-sig. |
| P0-004 | Decide and harden AI worker manual `/process/call` exposure. | Static bearer auth exists. SSRF residual on caller-supplied `recordingUrl`. | **partially fixed `25f096b`** | Codex + human for prod boundary | Auth gate closed (401/503). SSRF host allow-list + private-IP block on `recordingUrl` still open. |
| P0-005 | Verify launch-critical providers with real credentials. | Twilio, Stripe, Google, Microsoft, Anthropic, SMTP, and ANAF cannot be honestly claimed from mocks or source inspection. | blocked | human provides credentials; Codex verifies | No real provider credential tests were run. |
| P0-006 | Approve first flagship product/design workflow. | A generic module-heavy CRM will not beat Salesforce/HubSpot/Pipedrive/Attio. AMASS needs a focused action-first wedge. | needs input | human + Codex | Product/design audit recommends AMASS Pro Cockpit + Romania/EU wedge. |

## P1 — Important Before Production

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P1-001 | Reconcile `LAUNCH_CHECKLIST.md` with `RELEASE_CHECKLIST.md`. | Two launch checklists can diverge and mislead release decisions. | **resolved 2026-05-05** | Claude | LAUNCH_CHECKLIST.md marked DEPRECATED with redirect; RELEASE_CHECKLIST.md is now the single authoritative gate with security/secrets/RLS/smoke/integrations sections. |
| P1-002 | Fix or explicitly accept moderate dependency advisories. | `vite`, `esbuild`, and `postcss` advisories remain in non-production audit output. | open (high/critical resolved) | Codex | `SEC-002`; HIGH advisories resolved via axios override (`63628e9`); MODERATE dev-only advisories accepted until upstream releases. |
| P1-003 | Add local secrets scanner or document CI-only secret scanning. | Local secret-scan evidence is missing. | **resolved `855f241` 2026-05-05** | Claude | `.github/workflows/secret-scan.yml` runs gitleaks on push/PR/weekly; `SEC-003`. |
| P1-004 | Harden `WEBHOOK_TRUSTED_HOSTS` production behavior. | A dev escape hatch can become a production SSRF bypass if set accidentally. | **resolved `6a6fc4c` 2026-05-05** | Claude | `SEC-007`. |
| P1-005 | Decide webhook secret return policy and implement it. | If policy is "never return after creation", code is acceptable only for one-time creation display; if stricter, create must stop returning it. | **resolved `a9fca1a` 2026-05-05** | Claude | `SEC-008`; one-time display + rotate endpoint. |
| P1-006 | Build AMASS Pro Cockpit / Focus Queue at `/app`. | Users need a prioritized work surface, not just passive KPIs and many routes. | open | Codex | Current `dashboard.tsx` has KPI/brief foundation but not action queue. |
| P1-007 | Redesign Entity 360 pages around next action and relationship health. | Users should understand customer state and act in seconds. | open | Codex | `company.detail.page.tsx` has tabs; no synthesized action header yet. |
| P1-008 | Upgrade Command Palette into safe action execution. | Cmd/Ctrl+K should create/follow-up/log/update with audit and confirmation, not only navigate/search. | open | Codex | Current command palette route support exists; action execution is incomplete. |
| P1-009 | Ship import/onboarding wedge for SmartBill/GestCom/CSV. | Romania/EU data import is a credible wedge versus generic CRMs. | open | Codex + human domain input | Product audit points to existing docs/strategy references. |
| P1-010 | Add UX performance budgets and route smoke automation. | "Faster than big CRMs" needs measurable p95 route/action targets. | open | Codex | Browser smoke exists for auth + critical CRM; no performance budget yet. |
| P1-011 | Verify current CI after next push. | Local checks pass, but CI has not run for the current uncommitted changes. | open | Codex | Latest CI green only for `85e74e3`. |

## P2 — Polish / Post-Launch

| ID | Task | Why it matters | Status | Owner | Evidence |
|---|---|---|---|---|---|
| P2-001 | Normalize old/new design primitives across reports, campaigns, products, exports, and builders. | Visual drift reduces perceived product quality. | open | Codex | Product/design audit found older `Card` usage on some pages. |
| P2-002 | Redesign Report Builder into field picker/filter/preview flow. | Current comma-separated column input is not executive/admin-friendly. | open | Codex | Product/design audit. |
| P2-003 | Build unified communication inbox for email/calls/SMS/WhatsApp. | Entity tabs are useful, but daily communication needs one queue. | open | Codex | Email/calls/SMS/WhatsApp exist as modules, not unified queue. |
| P2-004 | Mobile/PWA field-sales mode with offline read and later sync. | Field users need fast mobile follow-up. | open | Codex | PWA exists; offline CRM flow not verified. |
| P2-005 | Vertical Romania/EU sales/service/invoicing packs. | Local compliance and ANAF/e-Factura can differentiate AMASS. | open | Codex + human domain input | Existing ANAF/product docs; real ANAF credentials still blocked. |

## Blocked

| Task | Blocker | What is needed |
|---|---|---|
| Twilio calls/SMS/WhatsApp | missing real SID/token/phone number/webhook setup | user must provide safe real/test credentials and callback URL |
| Google OAuth | missing client ID/secret/redirect setup | user must configure OAuth app and provide test account path |
| Microsoft Graph | missing app credentials/scopes/test mailbox | user must configure app registration and provide test account path |
| Stripe billing | missing real/test keys and webhook secret | user must provide Stripe setup depending on launch scope |
| Anthropic AI features | missing real API key | user must provide key or accept fallback-only verification |
| SMTP real email | missing real SMTP credentials | user must provide SMTP host/user/password/from-domain and test recipient |
| ANAF e-Factura | missing real/sandbox OAuth credentials and tenant fiscal data | user must provide ANAF credentials and safe fiscal test data |
| Product/design wedge | needs human product decision | choose first flagship workflow: recommended `AMASS Pro Cockpit + Romania/EU follow-up/invoicing wedge` |
