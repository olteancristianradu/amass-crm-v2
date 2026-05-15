# AMASS-CRM v2 — Architecture Map

> **Purpose of this file**: when something breaks at 2am, this is the
> first place to look. It tells you *which file* owns *which behaviour*
> and *how the layers fit together*. Module-level JSDoc headers in each
> `*.module.ts` go deeper — this is the bird's-eye view.

## Repo layout

```
amass-crm-v2/
├── apps/
│   ├── api/        NestJS 11 backend (the heart)
│   └── web/        React 19 frontend (Vite + TanStack Router/Query)
├── packages/
│   └── shared/     Zod schemas shared between BE+FE (build to dist/)
├── infra/
│   └── docker-compose.yml   Postgres + Redis + MinIO + Caddy
├── CLAUDE.md       Rules for AI sessions (read first every session)
├── LESSONS.md      Running log of mistakes — read second
└── docs/
    └── ARCHITECTURE.md   ← you are here
```

## The request lifecycle (NestJS execution order)

This order is the source of 80% of "why does my test fail" mysteries.
**Memorize it**: guards run BEFORE interceptors which run BEFORE pipes.

```
HTTP request
   ↓
1. Middleware                         (TenantContextMiddleware: parse JWT,
                                       set AsyncLocalStorage tenant ctx)
   ↓
2. Guards                             (JwtAuthGuard, RolesGuard)
   ↓                                  ⚠ if rejected here, multipart bodies
                                        cause supertest EPIPE — see LESSONS
3. Interceptors (request side)        (FileInterceptor parses multipart)
   ↓
4. Pipes                              (ZodValidationPipe parses body)
   ↓
5. Handler (controller method)
   ↓                                  → calls a service
                                      → service uses prisma.runWithTenant()
                                      → audit.log() + activities.log()
6. Interceptors (response side)
   ↓
7. Exception filters                  (AllExceptionsFilter shapes errors)
   ↓
HTTP response                         { code, message, details, traceId, timestamp }
```

## Multi-tenant isolation — three layers (defense in depth)

| Layer | Where | What it does | Failure mode if missing |
|-------|-------|--------------|-------------------------|
| **1. JWT → AsyncLocalStorage** | `common/middleware/tenant-context.middleware.ts` | Parses access token, sets `{tenantId, userId, role}` in AsyncLocalStorage for the request's lifetime | All tenant-scoped queries throw `requireTenantContext()` errors |
| **2. Prisma extension** | `infra/prisma/prisma.service.ts → tenantExtension()` | Auto-injects `where: {tenantId}` and `data: {tenantId}` on every read/write of tenant-scoped models | Queries forget the WHERE clause and leak rows. RLS still catches it |
| **3. Postgres RLS** | All migrations after `20260407210500_force_rls` | `ENABLE` + `FORCE` + `tenant_isolation_*` policies, enforced by `SET LOCAL ROLE app_user` | Last line of defense. If layer 1+2 fail, RLS still blocks reads at the DB |

**Critical**: layer 3 only works because `app_user` is `NOSUPERUSER NOBYPASSRLS`. Migrations still run as `postgres` (superuser) — that's intentional, DDL needs owner privileges. Data-plane queries switch via `SET LOCAL ROLE app_user`.

## Module map (where to look when X breaks)

| If broken... | Look at... | Why |
|-|-|-|
| Login/refresh/JWT issues | `modules/auth/` | Only module that bypasses runWithTenant (uses unique secure keys) |
| `/users` returns wrong tenant | tenantContext middleware + Prisma extension | Layer 1 or 2 failure |
| Cross-tenant data leak | RLS policies in `prisma/migrations/*` | Run `SELECT relrowsecurity, relforcerowsecurity FROM pg_class` |
| Company create works but timeline empty | `modules/companies/companies.service.ts` | Missing `activities.log()` call |
| Note 404s on a real subject | `modules/activities/subject-resolver.ts` | The polymorphic existence check |
| Import job stuck PENDING | `modules/importer/import.processor.ts` + Redis + MinIO | Worker not consuming, or storage unreachable |
| Attachment download 404 | `modules/attachments/attachments.service.ts` findOne() | Tenant context missing or row deleted |
| 400 INVALID_STORAGE_KEY | attachments.service.ts complete() | Defense-in-depth: storageKey must start with `<tenantId>/` |
| Reminder stuck PENDING past remindAt | `modules/reminders/reminders.processor.ts` + Redis | Worker not consuming OR job was removed by an aborted update/dismiss |
| 400 on POST /reminders (`remindAt must be in the future`) | `packages/shared/src/schemas/reminder.ts` | Schema rejects past dates so BullMQ delay is never negative |
| Email stuck QUEUED | `modules/email/email.processor.ts` + Redis | Worker not consuming, or SMTP credentials wrong/expired |
| Email FAILED with SMTP error | `modules/email/email.processor.ts` | Check account smtpHost/smtpPort/smtpSecure + password in DB (encrypted) |
| Email account password decryption fails | `common/crypto/encryption.ts` | ENCRYPTION_KEY env changed since password was stored → re-create account |

## Subsystems

### Polymorphic subjects

Four feature modules use the `(subjectType, subjectId)` pattern:
**NotesModule**, **AttachmentsModule**, **RemindersModule**, and (via logging only) **ActivitiesModule**.

The `SubjectType` enum lives in `prisma/schema.prisma`: `COMPANY | CONTACT | CLIENT`. Future sprints will add `DEAL`, `TASK`, `CALL`. Adding a new subject type = (1) extend the enum, (2) add a case to `SubjectResolver.assertExists()`, (3) migrate.

The route shape is `/:subjectType/:subjectId/<resource>` — case-insensitive (we toUpperCase + Zod parse).

### Storage (MinIO)

Two patterns coexist:

1. **Direct (FE → MinIO)** for attachments. Two-step: presign → FE PUT → complete. The API never sees the bytes.
2. **Server-side** for the importer. multer.memoryStorage() → `storage.putObject()` → BullMQ worker downloads via `storage.getObjectAsString()`. Used because the importer is admin-only with small files; the dedup logic needs the whole CSV in memory anyway.

Both pin storage keys to `<tenantId>/...` so even at the object-store level there's no cross-tenant leakage.

### BullMQ workers

Three queues today: `import` (S4), `reminders` (S7), and `email` (S11).

**Critical config**: every worker needs `connection.maxRetriesPerRequest = null` on the ioredis client. We construct it once in `infra/queue/queue.module.ts` and share it. If you see `BullMQ: Your redis options maxRetriesPerRequest must be null` in the logs, that's where the fix lives.

For now the processor runs in the API process. When we split to a separate worker container (post S18 deploy sprint), both must point at the same Redis URL. Idempotency is handled by passing `{ jobId: dbRowId }` to BullMQ, so accidental double-enqueues collapse.

### Real-time sync (B1)

Live data-sync over Socket.IO. **B1-PR1 lays the foundation only** — gateway + handshake + per-tenant rooms. Per-mutation publishers (PR3) and FE client (PR2) ship in follow-ups.

| Piece | File | Role |
|-|-|-|
| `SyncGateway` | `apps/api/src/infra/ws/sync.gateway.ts` | Socket.IO namespace `/sync`. On connect: verifies JWT (handshake auth.token → `Authorization: Bearer` → `amass_at` cookie), joins `tenant:<tid>` room. Invalid/missing/expired token → `socket.disconnect()`, never throws. |
| `SyncPublisherService` | `apps/api/src/infra/ws/sync-publisher.service.ts` | Thin facade feature modules inject. `publish(tenantId, event, payload)` delegates to `gateway.broadcast(...)`. Drops with a warn log if the Socket.IO server is null (boot race). |
| `WsModule` | `apps/api/src/infra/ws/ws.module.ts` | Wires both gateways. Imports `JwtModule` lazily so env validation isn't forced at module-import time. Exports `SyncPublisherService` (the public surface). |

**Isolation invariant**: `server.to('tenant:' + tenantId).emit(...)` confines every broadcast to one tenant's room. Tested explicitly in `sync.gateway.spec.ts` with two mock sockets in different rooms — a broadcast to tenant A must leave tenant B's inbox empty. This is the WS-layer twin of layers 1-3 in the multi-tenant defense-in-depth table above; if a publisher accidentally reads the wrong `tenantId`, this layer cannot save you, so per-mutation publishers (PR3) must source `tenantId` from `runWithTenant`'s context, not request payload.

Co-existing gateways:
- `/sync` (this) — domain mutation events, broadcast-to-tenant.
- `/notifications` (modules/notifications/notifications.gateway.ts) — per-user push, room `tenant:<tid>:user:<sub>`.
- `/ws` path (legacy WsGateway) — reminder fire-and-forget; will fold into SyncGateway once the FE migrates.

### Audit vs Activities

Two append-only streams, easy to confuse:

| | audit_logs | activities |
|-|-|-|
| Purpose | Security trail (who did what) | User-facing timeline feed |
| Mandatory? | Yes — failing to write is alarming | Best-effort — must NOT block the operation |
| Schema | `(actorId, action, subjectType, subjectId, ipAddress, userAgent, metadata)` | `(actorId, action, subjectType, subjectId, metadata)` |
| Read by | Future security console | Note/timeline endpoints in NotesController |

Both are tenant-scoped. Both are created from feature services (companies/contacts/clients/notes/attachments) on every mutation.

### Passkeys (B2) — COMPLETE

WebAuthn / FIDO2 lives in `apps/api/src/modules/webauthn/`. Backed by **@simplewebauthn/server v13** on the BE and **@simplewebauthn/browser v13** on the FE.

End-to-end flow shipped: a user can register a passkey at `/app/settings/security`, log in at `/login` with that passkey (Face ID / Touch ID / Windows Hello / YubiKey), see all registered devices, and revoke any one of them.

The surface is six endpoints — four ceremony calls plus device CRUD:

| Group | Call | Auth | PR |
|-|-|-|-|
| **Register** | `POST /webauthn/register/options` → PublicKeyCredentialCreationOptions | `JwtAuthGuard` | B2-PR1 |
| | `POST /webauthn/register/verify` → persist Passkey row | `JwtAuthGuard` | B2-PR1 |
| **Authenticate** | `POST /webauthn/authenticate/options` → PublicKeyCredentialRequestOptions + `userId` hint | `@Public()` | B2-PR2 |
| | `POST /webauthn/authenticate/verify` → mint `{ user, tokens }` (same shape as `/auth/login`) | `@Public()` | B2-PR2 |
| **Devices** | `GET /webauthn/devices` → `{ devices: [...] }` (newest first) | `JwtAuthGuard` | B2-PR4 |
| | `DELETE /webauthn/devices/:id` → 204 No Content, audited `webauthn.device_revoked` | `JwtAuthGuard` | B2-PR4 |

**FE register UI (B2-PR3):** `apps/web/src/features/passkeys/RegisterPasskeyButton.tsx`, mounted on `/app/settings/security`. Click → `passkeysApi.registerOptions()` → `startRegistration({ optionsJSON })` (browser native sheet) → `passkeysApi.registerVerify(response, deviceName?)`. Invalidates `passkeysQueryKey` on success so the device list refreshes automatically.

**FE login UI (B2-PR4):** `apps/web/src/features/passkeys/LoginWithPasskeyButton.tsx`, mounted above the email/password form on `/login`. Hidden entirely when `browserSupportsWebAuthn()` is false (no disabled control). Click → `authenticateOptions(email)` → `startAuthentication({ optionsJSON })` → `authenticateVerify(userId, response)` → `setSession(user, tokens)` → navigate to `/app`. Uniform "no passkey" error in Romanian that does NOT leak account presence.

**FE device list + revoke (B2-PR4):** `apps/web/src/features/passkeys/DeviceList.tsx`, mounted in the second card of `/app/settings/security`. Lists devices (relative timestamps via `Intl.RelativeTimeFormat('ro')`, transport badges, "Device necunoscut" fallback for null names), revoke button per row with `window.confirm` and a Romanian success toast.

- **Challenge store:** Redis with two separate prefixes so a register challenge can never be replayed into authenticate (different ceremony, different expected RP flags):
  - `webauthn:challenge:<userId>` — register challenge, TTL 300s, deleted on successful verify.
  - `webauthn:auth-challenge:<userId>` — login challenge, TTL 300s, deleted on successful verify (kept on failure so the user can retry with another authenticator inside the window — the assertion is signature-bound to the challenge so it can't be replayed by a third party).
- **Persistence:** Per-tenant `passkeys` table (RLS + tenantExtension scope every read/write). One row per registered authenticator; a user can have many (phone + laptop + hardware key). `credentialId` is globally unique (WebAuthn spec). `counter` (BigInt) and `lastUsedAt` (DateTime?) are updated atomically on every successful login.
- **RP identity:** `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` in env. Prod-only check rejects the dev defaults so a deploy without override fails fast.
- **Multi-tenancy (register):** `tenantId` always comes from the JWT (`@CurrentUser()`), never from the attestation payload. Register endpoints sit behind `JwtAuthGuard` — passkey enrolment is a "logged-in-user adds a new factor" flow, not a way to bootstrap an account.
- **Multi-tenancy (login):** pre-auth, no JWT yet. Mirrors `auth.service.login`'s tenant-resolution logic: explicit `tenantSlug` → direct user lookup; omitted slug + exactly-one user match across all tenants → use it; anything else → `INVALID_CREDENTIALS` (does NOT leak account presence). Once the user is resolved, `tenantId` comes from the User row and every Passkey read/update runs inside `runWithTenant(user.tenantId, …)`. A passkey registered under tenant A is invisible to a query running in tenant B's context.
- **Counter regression / cloned-credential defence:** every successful assertion carries a `newCounter` from the authenticator. If `newCounter <= storedCounter`, `verifyAuthentication` throws `WEBAUTHN_COUNTER_REGRESSION` and updates nothing — counter going backwards (or staying flat) means either a replay or a cloned private key on a second device. The exception is `newCounter == 0 && storedCounter == 0`, which is the well-known "this authenticator doesn't track a counter" case (some roaming credentials).
- **Token mint:** on successful verify, `WebauthnService` calls `AuthService.issueTokensForUser(user, meta)` — same access JWT + opaque refresh token + `sessions` row as `/auth/login`. The controller commits the refresh token to the httpOnly cookie and strips it from the JSON body, so the FE login flow is uniform across password / passkey paths.
- **Session-binding hint:** `authenticate/options` returns the resolved `userId` in its response. The FE echoes it back on `/verify`. The hint is not a credential — the actual proof is the WebAuthn assertion signature checked against the persisted public key. Tampering with the `userId` either fails to find the user OR finds a different user whose passkey list does not include the responder's `credentialId`, both falling through to `INVALID_CREDENTIALS`.

**Future (optional B2-PR5):** recovery codes integration — share the TOTP backup-codes module so a user who loses every registered authenticator can still get back in. Not blocking GA; passkey users with multiple devices (phone + laptop) already have redundancy.

### SCIM 2.0 (B3)

Identity-provider provisioning surface under `/scim/v2/Users` (RFC 7643/7644). Lives in `apps/api/src/modules/scim/`:

- `scim.controller.ts` — six routes (GET list, GET one, POST, PUT, PATCH, DELETE) all responding with `Content-Type: application/scim+json`. Tenant is currently extracted from the `X-Tenant-Id` header — **temporary scaffolding** until B3-PR3 wires real bearer-token auth. The controller is `@Public()`, so it must not be exposed on a public ingress until that PR lands.
- `scim.service.ts` — every method routes through `prisma.runWithTenant(tenantId, fn)` so the tenant extension auto-scopes queries and Postgres RLS enforces isolation at layer 3 (same multi-tenant defense-in-depth story as the rest of the app).
- `scim-mapper.ts` — pure functions converting between Prisma `User` rows and SCIM envelopes; covered by unit tests independent of DI.
- `scim.dto.ts` — Zod schemas for create/replace/patch bodies and list-query params.

Deliberate RFC 7644 deviations (kept narrow until a real IdP customer asks):
- **PATCH** supports only `op: "replace"` on `active`, `name.givenName`, `name.familyName`, and the primary email's `value`. Anything else returns 400 with `scimType: invalidPath`. Okta and Azure AD both send `replace` for these fields.
- **`filter` query param** supports only `userName eq "value"`. Anything else returns 400 with `scimType: invalidFilter`.
- **DELETE** is a soft-delete (`isActive=false`) and idempotent. There is no hard-delete path; deactivated users may still own FK-referenced rows (deals, leads, tasks).
- **Provisioned users** default to `role=VIEWER` (least privilege) with a sentinel `passwordHash` that can never satisfy bcrypt.compare — login by password is impossible, login by SSO is the intended path.

Out of scope for PR1: Groups (B3-PR2), bearer-token auth (B3-PR3), audit logging integration (B3-PR3), and the `ServiceProviderConfig` / `ResourceTypes` / `Schemas` meta endpoints (B3-PR4).

### Error shape

All errors flow through `common/filters/all-exceptions.filter.ts` and produce:

```json
{
  "code": "INVALID_STORAGE_KEY",
  "message": "storageKey does not belong to this tenant",
  "details": null,
  "traceId": "uuid-v4",
  "timestamp": "2026-04-08T..."
}
```

The `code` field is the contract — frontends and integration tests should match on it, never on the message string.

## Sprint progress (as of S7)

| Sprint | Status | What landed |
|-|-|-|
| S0 | ✅ | Repo skeleton, docker compose, placeholder packages |
| S1 | ✅ | NestJS bootstrap, Prisma, Auth (register/login/refresh/logout/me) |
| S2 | ✅ | Multi-tenant isolation (3 layers) + RBAC + audit log |
| S3 | ✅ | Companies + Contacts + Clients CRUD with isolation |
| S4 | ✅ | GestCom CSV importer with BullMQ |
| S5 | ✅ | Notes + polymorphic timeline (notes ∪ activities) |
| S6 | ✅ | Attachments + MinIO (two-step presigned upload) |
| S6.5 | ✅ | Bug fixes: auth refresh shape, importer→MinIO, web typecheck script, doc pass |
| S7 | ✅ | Reminders + BullMQ delayed jobs (polymorphic, fire → activity row) |
| S8 | ✅ | FE skeleton: Vite + React 19 + TanStack Router/Query + Tailwind + shadcn primitives + auth login flow |
| S9 | ✅ | FE Companies/Contacts/Clients list pages + Company detail with Timeline/Notes/Reminders/Attachments tabs |
| S10 | ✅ | Pipelines + Deals + Tasks: kanban BE/FE, default pipeline seeded on register, move endpoint recomputes status |
| S11 | ✅ | Email integration: per-user SMTP accounts (encrypted passwords), async send via BullMQ+Nodemailer, EmailTab on detail pages |
| S12 | 🟡 next | Calls (Twilio) |

## Frontend structure (S8 onwards)

```
apps/web/src/
├── main.tsx                  React bootstrap → <RouterProvider>
├── router.tsx                Route tree assembly (code-based TanStack Router)
├── global.d.ts               Shim for React 19's moved JSX namespace
├── styles.css                Tailwind v3 + CSS-var shadcn tokens
├── lib/
│   ├── api.ts                Typed fetch wrapper + silent 401 refresh + ApiError
│   ├── queryClient.ts        TanStack Query defaults (30s stale, no retry on 4xx)
│   ├── cn.ts                 clsx + tailwind-merge helper
│   └── types.ts              FE-side server response shapes
├── stores/
│   └── auth.ts               Zustand + localStorage persist (tokens + user)
├── components/
│   ├── ui/                   Button, Input, Label, Card, Textarea, Tabs
│   └── layout/AppShell.tsx   Sidebar + topbar + logout
├── routes/
│   ├── root.tsx              Root <Outlet>
│   ├── login.tsx             Public /login route (redirects authed users)
│   ├── authed.tsx            /app guard + <AppShell>
│   ├── dashboard.tsx         /app index
│   ├── companies.list.tsx    /app/companies + new company form
│   ├── company.detail.tsx    /app/companies/$id with 4 tabs
│   ├── contacts.list.tsx     /app/contacts
│   ├── clients.list.tsx      /app/clients
│   ├── reminders.mine.tsx    /app/reminders (personal upcoming list)
│   └── email-settings.tsx   /app/email-settings (SMTP accounts CRUD)
└── features/
    ├── auth/LoginForm.tsx      RHF + Zod, uses shared LoginSchema shape
    ├── companies/api.ts        Typed companiesApi.list/get/create/update/remove
    ├── contacts/api.ts
    ├── clients/api.ts
    ├── notes/api.ts            + NotesTab + TimelineTab (merged feed)
    ├── reminders/api.ts        + RemindersTab (status badge, dismiss, delete)
    ├── attachments/api.ts      + AttachmentsTab (two-step presigned upload driver)
    └── email/api.ts           + EmailTab (compose form + sent email list)
```

The `@amass/shared` package is consumed two ways:
- **apps/api** reads `packages/shared/dist/` (CJS built by tsc)
- **apps/web** aliases `@amass/shared` directly to `packages/shared/src/index.ts`
  in `vite.config.ts` + `tsconfig.json` — Rollup can't statically extract
  named exports through tsc's CJS `__exportStar` wrapper, so we feed it
  the TS source.

## Verification before committing

Always run, in order:

```bash
# 1. Static checks (api, web, shared)
pnpm --filter @amass/shared build
pnpm --filter @amass/api typecheck
pnpm --filter @amass/api build
pnpm --filter @amass/web typecheck
pnpm --filter @amass/web build

# 2. Tests (require docker compose up: postgres + redis + minio)
cd apps/api && DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public' \
  JWT_SECRET='test-jwt-secret-needs-to-be-at-least-32-characters-long' \
  JWT_REFRESH_SECRET='test-refresh-secret-also-needs-32-chars-min-length' \
  REDIS_URL='redis://localhost:6379' \
  MINIO_ENDPOINT='http://localhost:9000' \
  pnpm vitest run

# 3. Migration drift check
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public' \
  pnpm exec prisma migrate diff \
  --from-url "postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
# exit 0 = no drift, exit 2 = drift, exit 1 = error
```

## Where to add new features

| Adding... | Read first | Then create |
|-|-|-|
| New CRUD module | `modules/companies/` for the template | `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.e2e.spec.ts` |
| New polymorphic subject type | `modules/activities/subject-resolver.ts` | Add enum value + case in resolver + migration |
| New BullMQ queue | `infra/queue/queue.module.ts` and `modules/importer/import.processor.ts` | Add `QUEUE_X` constant, register in queue.module, add `@Processor()` |
| New shared Zod schema | `packages/shared/src/schemas/note.ts` for the template | New file in `packages/shared/src/schemas/`, export from index, run `pnpm --filter @amass/shared build` |
| New env var | `apps/api/src/config/env.ts` | Add to Zod schema with sensible default for dev |
| New FE page | `apps/web/src/routes/companies.list.tsx` for a list template, `company.detail.tsx` for a detail | New file in `routes/`, register it in `router.tsx`'s `routeTree`, add sidebar link in `AppShell` if top-level |
| New FE API binding | `apps/web/src/features/companies/api.ts` for the template | New `features/<thing>/api.ts` that imports the `api` wrapper from `@/lib/api` |
