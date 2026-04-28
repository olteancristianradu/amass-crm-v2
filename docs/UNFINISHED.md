# UNFINISHED — autonomous overnight 2026-04-27 → 2026-04-28

> What I did NOT finish in the autonomous slot. Each entry is a real
> task that still needs to ship; priority + effort estimate are honest.
> Order is *roughly* the order I'd tackle them next.

## P0 — needs human/credentials/ops

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

### onDelete: Cascade audit
- 45/79 Prisma models still don't declare an `onDelete` rule on FK
  relations. Risk: orphans on parent delete. Need an audit pass +
  one migration that adds Cascade where it makes sense and SetNull
  where the child should survive.
- Estimated effort: 90 min for the audit + a single migration.

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
