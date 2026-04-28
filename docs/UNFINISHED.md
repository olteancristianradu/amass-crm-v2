# UNFINISHED — autonomous overnight 2026-04-27 → 2026-04-28

> What I did NOT finish in the autonomous slot. Each entry is a real
> task that still needs to ship; priority + effort estimate are honest.
> Order is *roughly* the order I'd tackle them next.

## ⚠️ Design contrast audit — Faza G dedicată (after A→F)

User flagged 2026-04-28 during Faza A live verification: in the
invoices list (and "etc" — implying it's not just one page) several
buttons / interactive controls have text that's almost invisible
against the surface they sit on. Almost certainly happens on:
- selected / active state of secondary/ghost buttons
- StatusBadge tones on translucent glass cards
- focus rings on `ring-ring` over the new alpha-blended backgrounds

To do later as a dedicated audit:
1. axe-core run on every page (capture violations)
2. Manual contrast check on the design-system v2 token palette
   against the canvas alpha — fix CSS variables to clear WCAG 2.1 AA
   (4.5:1 normal text, 3:1 large text + UI components)
3. Same audit re-run under `data-theme="dark"` — different tokens,
   different pitfalls
4. Storybook / `routes/design-preview.page.tsx` already exists; use
   it as the manual playground

Estimated effort: 3–4h depending on how many tones need swapping.
Do NOT skip this — accountants on small screens will hate the app
if buttons in the invoice list aren't legible.

## P0 — needs human/credentials/ops

### `git push origin main`
- Five overnight commits (`d0d9f1c` … `4070ab2`) are queued locally
  but `git push` failed with `could not read Username for
  'https://github.com'`. The repo is on HTTPS and the keychain has
  no entry; no SSH key in `~/.ssh/`; no `GH_TOKEN` / `GITHUB_TOKEN`
  in env; `gh` CLI not installed. To unblock:
  ```bash
  # Either install gh + login (one-time):
  brew install gh && gh auth login -h github.com -p https
  # OR add an SSH key:
  ssh-keygen -t ed25519 -C "cristian.raduoltean@gmail.com"
  pbcopy < ~/.ssh/id_ed25519.pub  # paste into github.com/settings/keys
  git remote set-url origin git@github.com:olteancristianradu/amass-crm-v2.git
  # Then:
  git push origin main
  ```


### Cloudflare Tunnel
- `cloudflared` is installed (`/opt/homebrew/bin/cloudflared`) but
  `~/.cloudflared/cert.pem` does not exist, so I cannot create a
  named tunnel non-interactively. The next interactive step is:
  ```bash
  cloudflared tunnel login          # opens a browser to your CF account
  cloudflared tunnel create amass-crm
  cloudflared tunnel route dns amass-crm <your.subdomain>
  cat > ~/.cloudflared/config.yml <<'YML'
  tunnel: amass-crm
  credentials-file: /Users/radu-server/.cloudflared/<TUNNEL-ID>.json
  ingress:
    - hostname: <your.subdomain>
      service: http://localhost:80
    - service: http_status:404
  YML
  sudo cloudflared service install
  ```
- Once that's done, capture the public URL into `DEPLOY.md` and verify
  end-to-end (browser load + a presigned MinIO download via the tunnel).

### `pmset` — prevent Mac sleep
- The user asked for `sudo pmset -a sleep 0 disksleep 0 displaysleep 0`.
  I did NOT run this without an explicit sudo prompt. To run:
  ```bash
  sudo pmset -a sleep 0 disksleep 0 displaysleep 0
  pmset -g                            # confirm Sleep=0, DisksSleep=0
  ```

### Stripe-mock plumbing
- `stripe-mock` is up at `:12111` but the API's billing module
  constructs Stripe with `new StripeLib(env.STRIPE_SECRET_KEY, ...)` —
  there's no env override for the API base. To wire it:
  1. Add `STRIPE_API_BASE` (or reuse `STRIPE_HOST`/`PORT`/`PROTOCOL`)
     to `apps/api/src/config/env.ts`.
  2. Plumb into `apps/api/src/modules/billing/billing.service.ts`
     `new StripeLib(key, { apiVersion: '...', host: 'stripe-mock', port: 12111, protocol: 'http' })`.
  3. End-to-end test: create a subscription → verify webhook (signed
     by stripe-mock) → confirm `BillingSubscription` row updated.
- Estimated effort: 30–45 min.

### Twilio / Meta / Google / Microsoft / ANAF base-URL plumbing
- Same shape as Stripe. Each integration currently hits the public
  hostname (`api.twilio.com`, `graph.facebook.com`, `oauth2.googleapis.com`,
  etc.). To exercise the mocks built tonight, add `*_BASE_URL` env
  vars + thread them through the SDK constructors.
- Estimated effort: 90 min for all five (each is a 15–20 min wire-up).

## P1 — security / quality push

### Cedar coverage on the remaining 31 controllers
- Now at 33/64 (started session at 18/64). Skipping list intentionally
  excludes scaffold-501 modules and read-only controllers. Concrete
  next targets:
  - `lead-scoring`, `report-builder`, `formula-fields`,
    `validation-rules`, `chatter`, `events`, `customer-subscriptions`,
    `payments`, `product-bundles`, `product-variants`, `phone-numbers`,
    `calendar`, `importer`, `audit` (read-only sensitive endpoints
    deserve `audit::read` decoration even if they don't mutate).
- Pattern is already proven — see `apps/api/src/modules/notes/notes.controller.ts`.
- Estimated effort: 90 min for the lot.

### Test suite — fix the 112/806 unit failures
- Three error families cluster the failures:
  1. `vi.mocked()` against PrismaService casts losing `.mock`. Fix
     pattern documented in LESSONS.md (2026-04-25 — vi.mocked() doesn't
     infer types when the wrapped object is cast to PrismaService).
  2. `Cannot read properties of undefined (reading 'DELIVERED')` etc.
     when an enum from `@prisma/client` resolves to undefined under the
     vitest swc transform. Likely needs a `vi.mock('@prisma/client')`
     factory that re-exports the enums.
  3. Service constructor signature drift (the dual-arity
     `runWithTenant` mock pattern from LESSONS.md).
- Estimated effort: 2–3 hours, mostly mechanical.

### Coverage push (current state captured 2026-04-28)

`pnpm vitest run --coverage` against `main` post-Faza C:

| Module                | Line %  | Branch % | Notes |
|-----------------------|---------|----------|-------|
| `infra/prisma`        | 86.27   | 84.21    | ≥80 ✓ |
| `modules/deals`       | 87.05   | 87.27    | ≥80 ✓ |
| `modules/calls`       | 73.66   | 84.47    | close |
| `modules/audit`       | 70.00   | 78.57    | close |
| `modules/auth`        | 65.52   | 89.31    | service ≥80; controller drags |
| `modules/anaf`        | 80.35   | 64.28    | ≥80 ✓ |
| `modules/notes`       | 72.63   | 93.54    | close |
| `modules/cases`       | 62.98   | 60.00    | mid |
| `modules/email`       | 58.55   | 69.64    | mid |
| `modules/gdpr`        | 72.61   | 80.95    | close |
| `modules/leads`       | 14.23   | 78.57    | **needs work** — 302 LOC service, only 120 LOC spec |
| `modules/sms`         | 22.41   | 27.27    | **needs work** |
| `modules/ai`          | 30.31   | 65.75    | **needs work** — multiple services |
| scaffolds (scim/webauthn/sync) | 100 | 100 | 501 stubs only |

The `infra/queue`, `infra/redis`, `infra/storage`, `infra/ws` infra
modules sit at 25–30% line; their cores are integration paths
(BullMQ workers, Socket.IO gateway, MinIO S3 client) that are e2e-
tested with the live Docker stack rather than mocked at the unit
level. Module total numbers also include `*.module.ts` and
`*.controller.ts` files that are 0% by design (controllers are
e2e/integration tested).

**Target for next sprint**: bring `leads`, `sms`, `ai` to ≥50% line
each, push `auth`/`calls`/`audit` over the 80% mark by adding the
specific edge-case branches that aren't currently asserted (mostly
error paths). Estimated 4h focused work.

### onDelete: business cross-references — focused refactor (deferred)

Re-audited 2026-04-28 after the wider Faza C work landed. Live state of
the schema (verified via `pg_constraint` query, full output saved
during the audit run):

- **38 existing FK constraints**: every one already declares the
  correct ON DELETE clause (Cascade for sub-resources, SetNull for
  optional people-refs, Restrict for legal-preservation rows like
  `quotes.company_id`). No drift.
- **26 business cross-references** still defined as plain `xxxId String`
  text columns with no `@relation` and therefore no DB FK constraint.
  Listed below with the recommended `onDelete` strategy for each.
  These are improvements, not security gaps — the existing layered
  defense (RLS + soft-delete on deletedAt) prevents observable orphans
  at the read paths that matter.

Recommended map for the focused refactor (~3–4h work + a single
catch-up migration):

| relation                               | onDelete strategy |
|----------------------------------------|-------------------|
| Deal.companyId / Deal.contactId        | SetNull           |
| Deal.ownerId                           | SetNull           |
| Task.assigneeId                        | SetNull           |
| Invoice.companyId                      | Restrict (legal)  |
| Invoice.dealId                         | SetNull           |
| Project.{companyId,dealId}             | SetNull           |
| Quote.dealId                           | SetNull           |
| Quote.invoiceId                        | SetNull           |
| SequenceEnrollment.contactId           | Cascade           |
| ApprovalRequest.quoteId                | Cascade           |
| AnafSubmission.invoiceId               | Cascade           |
| PortalToken.{companyId,clientId}       | Cascade           |
| SmsMessage.contactId                   | SetNull           |
| Lead.ownerId                           | SetNull           |
| Contract.companyId                     | Restrict (legal)  |
| CustomerSubscription.companyId         | Restrict (legal)  |
| Case.{companyId,contactId,assigneeId}  | SetNull           |
| Order.companyId                        | Restrict (legal)  |
| Order.quoteId                          | SetNull           |
| EventAttendee.{contactId,clientId}     | Cascade           |

Each row needs: inverse field on the parent model (`Company.deals`,
`Company.invoices`, etc.), `@relation` block on the child with
`onDelete: …`, plus the Postgres-level FK in the migration. Do this in
ONE migration to avoid the drift this avoidance pattern was created to
prevent. After this, the schema will be at 64 / 64 declared FKs.

### onDelete: Cascade — proper finding from the audit
- The shape of the issue is bigger than first thought: the schema has
  92 FK-style columns (`xxxId String`) that have NO `@relation`
  navigation at all — Prisma cannot attach an `onDelete` rule to
  those because there's nothing to attach it to. The 38 declared
  `@relation()` blocks already all have an `onDelete` (verified
  2026-04-28 with a script).
- Categories of the 92 unrelated FKs:
  1. **Polymorphic** (subjectId on Note/Reminder/Activity/Attachment)
     — by design no single parent.
  2. **Audit/historical** (actorId, createdById, uploadedById,
     authorId) — should NOT cascade; we keep the row even after the
     user is removed, otherwise audit history disappears.
  3. **Business cross-references** (Deal.companyId, Task.assigneeId,
     EmailMessage.subjectId, etc.) — these SHOULD probably have
     onDelete:SetNull (or the soft-delete + RLS pattern that's
     already in place).
- Hard part: turning #3 into proper `@relation` + onDelete requires
  adding inverse list relations on the parents (`Company.deals`,
  `User.assignedTasks`), generating a catch-up migration that doesn't
  destroy data, and a re-test of the relevant services. Estimated
  effort: 3–4 hours for the full sweep — not just one migration.
- Risk mitigation in place today:
  - All these models have `tenantId` + Postgres RLS, so a stale FK
    can't leak across tenants.
  - The services use `softDelete` rather than `delete` everywhere it
    matters, so the "parent gone" scenario is "parent has
    `deletedAt != null`", which all the read paths already filter.

### RLS audit re-run
- Last full sweep was 2026-04-14. Schema has gained ~10 models since.
  Need to re-run the RLS coverage script + apply policy SQL for any
  table that ships without it.

## P2 — features queued from Phase 4

Out of the 15 items in the brief I shipped only:
- ✅ Dark mode (light/dark/system tri-state, persisted)

Not shipped tonight, in priority order:

1. **Inline editing universal** — click any cell on a list to edit. ~3h.
2. **Bulk operations real handlers** — UI selection already exists,
   the API endpoints + multi-select dialogs need wiring. ~2h.
3. **Saved views / tabs** — schema already supports filters; FE
   needs a saved-view sidecar + URL persistence. ~2h.
4. **Cmd-K AI intent** — palette already debounces on `/ai/search`;
   missing the structured-output prompt to map free text to a route
   or action. ~90min.
5. **AI mail draft** — placeholder service exists; needs Gemini
   structured-output wiring + FE widget. ~90min.
6. **Sentiment timeline on company detail** — needs aggregate over
   `EmailMessage.sentimentScore` and `Call.aiSummary`. ~2h.
7. **Win/loss analyzer on forecasting** — backend route
   `forecasting/winloss` already half-stubbed. ~2h.
8. **Smart reminders triggers** — `DEAL_INACTIVE_DAYS` etc. need a
   cron + a rule engine on top of WorkflowsService. ~3h.
9. **Custom dashboard widgets drag-drop** — react-grid-layout +
   schema for widget config. ~4h.
10. **Chatter realtime via WebSocket** — Socket.IO gateway already
    wired for notifications; chatter just needs to subscribe. ~90min.
11. **Mobile PWA offline cache** — service-worker is registered; the
    cache strategy currently skips `/api/`. To support offline reads,
    we'd add a stale-while-revalidate over GET /companies, /contacts
    with tenant-scoped cache keys. ~3h.
12. **Performance bundle <300KB / <80KB gzip** — main bundle is
    440KB / 106KB gzip after this session. Top wins:
    - Lazy-load lucide-react icons (huge import surface)
    - Code-split the AI worker UI panels
    - Dedupe TanStack Query/Router/Table chunk
    Estimated: 3h.
13. **A11y WCAG 2.1 AA** — Need axe-core run + manual screen-reader
    pass on the Cmd-K palette and Kanban DnD. ~3h.
14. **ANAF e-Factura UI** — backend ready (verified live with
    anaf-mock tonight); FE needs the submit button on invoice detail
    + status polling card. ~90min.

## P3 — observability / ops nice-to-haves

- OpenTelemetry tracing — deferred per CLAUDE.md until justified; not
  hot here.
- Audit log SIEM forwarder is wired but never load-tested at scale.
- Backups / volume snapshots — `infra/scripts/` has a `bootstrap-vps`
  but no scheduled `pg_dump` to S3 (or anywhere off-host). Need one
  before the first paying tenant.

## Notes from tonight that other sessions should read

1. The Postgres column-naming pattern in this repo is **camelCase
   without `@map`** — except `invoices`, `email_tracking`,
   `webhook_deliveries` which DO use `@map` to snake_case. Any new
   raw SQL must check the actual `\d table` first; assuming snake_case
   gives 42703s (this killed `/reports/dashboard` until I fixed it
   tonight — see commit message and LESSONS.md).
2. `AccessControlModule` is `@Global()` — when adding `@RequireCedar`
   to a controller, do NOT add an import to the module, just import
   `CedarGuard` and `RequireCedar` in the controller file and append
   `CedarGuard` to `@UseGuards(...)`.
3. Mock services (`pnpm mocks:up`) live under
   `apps/mock-services/server.js` as a single Express process bound
   to ports 3001–3007. Adding a new mock = a new `app.METHOD(...)`
   line — no separate container.
