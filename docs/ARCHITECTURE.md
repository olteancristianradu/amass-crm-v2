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

Live data-sync over Socket.IO. **B1-PR1** ships gateway + handshake + per-tenant rooms; **B1-PR2** wires per-mutation publishers (deals/invoices/calls); **B1-PR3** ships the FE consumer documented below; **B1-PR4** adds presence indicators ("+N persoane văd această pagină") on detail pages.

| Piece | File | Role |
|-|-|-|
| `SyncGateway` | `apps/api/src/infra/ws/sync.gateway.ts` | Socket.IO namespace `/sync`. On connect: verifies JWT (handshake auth.token → `Authorization: Bearer` → `amass_at` cookie), joins `tenant:<tid>` room. Invalid/missing/expired token → `socket.disconnect()`, never throws. Also handles `presence:enter`/`presence:leave` (B1-PR4) — payload-supplied tenantId/userId is ignored; the trusted values come from `client.data` set at handshake. |
| `SyncPublisherService` | `apps/api/src/infra/ws/sync-publisher.service.ts` | Thin facade feature modules inject. `publish(tenantId, event, payload)` delegates to `gateway.broadcast(...)`. Drops with a warn log if the Socket.IO server is null (boot race). |
| `PresenceService` | `apps/api/src/infra/ws/presence.service.ts` | Redis-backed presence map (B1-PR4). Primary key shape `presence:<tenantId>:<resourceType>:<resourceId>` → Set<userId> with 60s TTL (heartbeat-refreshed). Secondary index `presence:socket:<socketId>` → Set<JSON{tenantId, resourceType, resourceId, userId}> lets `cleanupSocket()` revoke a dead socket from every resource it was watching in one Redis round-trip. tenantId is the first segment of every primary key — cross-tenant leaks are impossible by construction (tested explicitly in `presence.service.spec.ts`). Internal to WsModule. |
| `WsModule` | `apps/api/src/infra/ws/ws.module.ts` | Wires both gateways. Imports `JwtModule` lazily so env validation isn't forced at module-import time. Registers `PresenceService` as an internal provider (only `SyncGateway` consumes it). Exports `SyncPublisherService` (the public surface). |
| `SyncProvider` (FE) | `apps/web/src/features/sync/SyncProvider.tsx` | Mounted inside `<AppShell>`. Opens `io('/sync', { auth: { token } })` when authed, wires the event → React Query invalidation table. Exposes the live socket via `useSyncSocket()` so feature hooks (presence today, optimistic channels later) share one connection. Returns `<>{children}</>` — no UI. Reconnect handled natively by socket.io (1-5s backoff). |
| `useSyncStatus` (FE) | `apps/web/src/features/sync/useSyncStatus.ts` | `{ connected, lastEventAt }` view onto the `useSyncStore` (Zustand). Consumed by the topbar "Live" badge in AppShell. |
| `usePresence` (FE) | `apps/web/src/features/sync/usePresence.ts` | `usePresence(resourceType, resourceId) → { viewerUserIds, count }` (B1-PR4). On mount emits `presence:enter`, heartbeats every 30s (inside the 60s server TTL), subscribes to `presence:joined`/`presence:left` filtered to this resource, emits `presence:leave` on unmount. Self-userId filtered out of the returned list. |
| `PresenceBadge` (FE) | `apps/web/src/features/sync/PresenceBadge.tsx` | Renders the "+N persoane văd această pagină" chip (Eye icon, Romanian noun agreement for 1 vs N). Renders nothing when `viewerUserIds` is empty. Wired into company/contact/client detail pages next to the title. |

**Isolation invariant**: `server.to('tenant:' + tenantId).emit(...)` confines every broadcast to one tenant's room. Tested explicitly in `sync.gateway.spec.ts` with two mock sockets in different rooms — a broadcast to tenant A must leave tenant B's inbox empty. This is the WS-layer twin of layers 1-3 in the multi-tenant defense-in-depth table above; if a publisher accidentally reads the wrong `tenantId`, the layer cannot save you, so per-mutation publishers must source `tenantId` from `runWithTenant`'s context (or the entity's own `tenantId` field for webhook-driven paths like Twilio status callbacks), not request payload.

**Publisher contract (B1-PR2)**:
- Emit **after** the DB write succeeds — no premature broadcasts.
- **Fire-and-forget**: never `await` the publisher; wrap in a per-service `safePublish()` helper so a thrown publisher (gateway not booted, broken payload, anything) degrades to a warn log and cannot bubble into the mutation path or stall the HTTP request.
- Payloads stay small — just enough for the FE to invalidate React Query keys. Full entities re-fetch on demand.

**Event catalog** (server-side, B1-PR2):

| Event | Emitted from | Payload | When |
|-|-|-|-|
| `deal.moved` | `DealsService.move` | `{ dealId, fromStageId, toStageId, dealStatus }` | Every kanban move (same-stage DnD reorders included) |
| `deal.won` | `DealsService.move` | `{ dealId, amount, currency }` | Move crosses into a `WON` stage from a non-WON state |
| `deal.lost` | `DealsService.move` | `{ dealId, lostReason }` | Move crosses into a `LOST` stage from a non-LOST state |
| `invoice.status_changed` | `InvoicesService.changeStatus` | `{ invoiceId, fromStatus, toStatus }` | Every user-initiated status transition (payment-driven recompute is a separate path, not yet broadcast) |
| `call.completed` | `CallsService.handleStatusWebhook` | `{ callId, duration }` | Twilio status webhook lands on `COMPLETED` |

**FE event → query-key invalidation** (kept in lockstep with publishers):

| Server event | Invalidated React Query key |
|-|-|
| `deal.moved` | `['deals']` |
| `deal.won` | `['deals']` |
| `deal.lost` | `['deals']` |
| `invoice.status_changed` | `['invoices']` |
| `call.completed` | `['calls']` |

We invalidate rather than patch in place: cheapest correct behaviour, and the next refetch makes the server the canonical source-of-truth (no risk of skew between an optimistic local merge and the server projection). Presence shipped in B1-PR4 (see below); offline buffer in B1-PR5; load test in B1-PR6.

**Presence (B1-PR4)** events, FE-driven:

| Event | Direction | Payload | Notes |
|-|-|-|-|
| `presence:enter` | FE → BE | `{ resourceType, resourceId }` | tenantId/userId NOT in payload — sourced from JWT-verified `client.data`. Idempotent; heartbeats every 30s. |
| `presence:leave` | FE → BE | `{ resourceType, resourceId }` | Emitted on hook unmount (route change, tab close). |
| `presence:joined` | BE → FE (tenant room) | `{ resourceType, resourceId, userId }` | Broadcast after `enter` lands in Redis. |
| `presence:left` | BE → FE (tenant room) | `{ resourceType, resourceId, userId }` | Broadcast after `leave` lands; also emitted by `handleDisconnect` for every resource the dead socket was watching (via `PresenceService.cleanupSocket`). |

Redis schema: primary set `presence:<tenantId>:<resourceType>:<resourceId>` (Set<userId>, TTL 60s); secondary index `presence:socket:<socketId>` (Set<JSON entry>, TTL 60s) for crash-safe cleanup. Both keys' TTLs are refreshed every `presence:enter` so the FE heartbeat keeps them alive while the tab is open. If the tab/network dies the entry self-expires within 60s — no zombie viewers.

#### Offline write buffer (B1-PR5)

When `fetch` rejects with a network error (DNS failure, browser offline, server unreachable) on a mutation (`POST`/`PATCH`/`PUT`/`DELETE`) under `/api/v1/`, `apps/web/src/lib/api.ts` redirects it through `offlineQueue.enqueue(...)` instead of throwing. The call resolves synchronously with `{ queued: true, queuedId }` so React Query's optimistic update is **not** rolled back.

| Piece | File | Role |
|-|-|-|
| `offlineQueue` | `apps/web/src/features/offline/offline-queue.ts` | `idb` wrapper around the `amass-offline-v1` IndexedDB. Store `mutations` keyed by autoincrement id. Methods: `enqueue / dequeue / peekAll / incrementAttempt`. |
| `useOfflineQueue` | `apps/web/src/features/offline/useOfflineQueue.ts` | React hook. Returns `{ pendingCount, isReplaying, lastError, replay }`. Subscribes to `window.online` to auto-replay on reconnect; also polls every 5s to catch cross-tab enqueues. |
| `OfflineIndicator` | `apps/web/src/features/offline/OfflineIndicator.tsx` | Topbar chip. Hidden when online with empty queue. Amber when offline. Blue with spinner + count while draining. |

**Exclusions** (never queued — always thrown):
- `GET` (reads are not safe to replay — they have no commit semantics).
- `/api/v1/auth/*` (token issuance — replaying a stale login is meaningless).
- `/api/v1/webhooks/*` (inbound only; defensive).
- `/api/v1/uploads/*` presigned URL issuance (short TTL would be expired by replay time).

**Replay strategy**:
- **Sequential** drain — never parallel. Two queued mutations on the same entity could race and re-introduce the conflict problem we deliberately punted on.
- **Exponential backoff** per row: 1s, 2s, 4s, 8s, 16s, capped at 30s. The `attempts` counter lives on the IndexedDB row, so backoff survives page reloads.
- **4xx → drop + surface**: a 400 from the server means the body was invalid; retrying won't help and would block every later mutation in the queue. The error bubbles to `useOfflineQueue().lastError` for the indicator tooltip.
- **5xx / network error → keep + back off**: transient. The next `online` event or interval tick re-tries.
- **Auth header re-injection at replay**: the access token may have rotated between enqueue and replay, so the hook reads the current token from `useAuthStore` at execute-time (mirroring `api.ts`'s pattern). The body and other headers are persisted verbatim from the original call.
- **Cache invalidation after success**: extracts the first path segment after `/api/v1/` and calls `queryClient.invalidateQueries({ queryKey: [segment] })` so the FE refetches once the canonical server projection is durable.

**Conflict policy**: last-write-wins. No CRDT, no operational transform. If two tabs queue conflicting PATCHes, the second replay overwrites the first — same as online behaviour. Per-user / per-tenant queue partitioning is deferred to B1-PR6 (today the queue is a single device-wide store).

**Limitations** (acknowledged, not bugs):
- Repeatedly clicking "Save" while offline enqueues N rows. No dedupe in PR5.
- File uploads are not queued — they'd blow IndexedDB quota and the presigned-PUT TTL.
- Replay does **not** show per-row progress in PR5; the indicator just shows the running total.

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

Identity-provider provisioning surface under `/scim/v2/Users` and `/scim/v2/Groups` (RFC 7643/7644). Lives in `apps/api/src/modules/scim/`:

- `scim.controller.ts` — twelve routes total (six for /Users, six for /Groups) all responding with `Content-Type: application/scim+json`. Authenticated via **`ScimBearerGuard`** (B3-PR3): every request must carry `Authorization: Bearer <token>` where `<token>` is an opaque per-tenant credential issued by the admin surface below. The guard resolves the token to a `tenantId` and attaches it to the request (`req.scimTenantId`); the controller reads that, NOT a header. `@Public()` keeps the global `JwtAuthGuard` from intercepting — these tokens are not JWTs.
- `scim-bearer.guard.ts` — verifies the bearer token via `ScimTokenService.verifyToken`, emits an `scim.api_call` audit entry on every successful call, and binds `req.scimTenantId` + `req.scimTokenId`. Failure modes (missing header, malformed prefix, unknown token, revoked token) all collapse to 401 so a probing IdP can't distinguish between them.
- `scim-token.service.ts` — token lifecycle. `create()` generates 32 random bytes (`base64url`, ~256-bit entropy), persists `sha256(raw)` to `scim_tokens.tokenHash`, and returns the raw token **exactly once** (GitHub-PAT pattern). `verifyToken()` hashes + lookups by `tokenHash` (globally unique, indexed) + filters by `revokedAt IS NULL` + fires-and-forgets a `lastUsedAt` bump. `revoke()` is idempotent; revoked tokens never re-activate.
- `scim-admin.controller.ts` — JWT-protected admin surface under `/scim/tokens` for tenant `OWNER`/`ADMIN` to `GET` (list metadata only — never the raw token or hash), `POST` (create + receive raw once + warning in body), and `DELETE` (revoke). Token creation + revocation are audit-logged as `scim.token_created` / `scim.token_revoked`.
- `scim.service.ts` — /Users CRUD. Every method routes through `prisma.runWithTenant(tenantId, fn)` so the tenant extension auto-scopes queries and Postgres RLS enforces isolation at layer 3 (same multi-tenant defense-in-depth story as the rest of the app).
- `scim-groups.service.ts` — /Groups CRUD against the synthetic, role-derived group model (see below). Same `runWithTenant` discipline. Every effective membership change is audited via the global `AuditService` (`scim.group.member_added` / `scim.group.member_removed`).
- `scim-mapper.ts` — pure functions converting between Prisma rows and SCIM envelopes (User↔ScimUser and UserRole↔ScimGroup, plus PatchOp parsing for both); covered by unit tests independent of DI.
- `scim.dto.ts` — Zod schemas for create/replace/patch bodies and list-query params (both /Users and /Groups).

**Bearer flow + token lifecycle (B3-PR3)**: operator hits `POST /scim/tokens` from CRM admin UI → receives raw token in the response body alongside a "store now, won't be shown again" warning → pastes it into Okta / Azure AD provisioning config → IdP starts sending `Authorization: Bearer <token>` to `/scim/v2/...` → every call bumps `lastUsedAt`. Compromised? Admin calls `DELETE /scim/tokens/:id`; the next IdP call returns 401 immediately because the verify path filters by `revokedAt IS NULL` (no Redis blocklist needed). Token rotation = create a new token, switch the IdP to it, revoke the old one. Multi-IdP = multiple rows in `scim_tokens` per tenant (e.g. "Okta production" + "Okta staging"). Cross-tenant safety: `tenantId` is read off the token's DB row, not from a client-supplied header — a tenant-A token cannot ever authenticate as tenant-B, even if an attacker crafts a request claiming otherwise.

Deliberate RFC 7644 deviations on /Users (kept narrow until a real IdP customer asks):
- **PATCH** supports only `op: "replace"` on `active`, `name.givenName`, `name.familyName`, and the primary email's `value`. Anything else returns 400 with `scimType: invalidPath`. Okta and Azure AD both send `replace` for these fields.
- **`filter` query param** supports only `userName eq "value"`. Anything else returns 400 with `scimType: invalidFilter`.
- **DELETE** is a soft-delete (`isActive=false`) and idempotent. There is no hard-delete path; deactivated users may still own FK-referenced rows (deals, leads, tasks).
- **Provisioned users** default to `role=VIEWER` (least privilege) with a sentinel `passwordHash` that can never satisfy bcrypt.compare — login by password is impossible, login by SSO is the intended path.

#### /Groups — synthetic, role-derived (B3-PR2)

amass-crm has no Group/Team table. The 5 SCIM Groups exposed per tenant are SYNTHESIZED 1:1 from the `UserRole` enum (`OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER`). Each group's stable id is `role:${UserRole}` (e.g. `role:ADMIN`), `displayName` matches the role name, and membership = the set of users whose `User.role` equals that role.

- **GET /Groups** — always returns 5 entries with current member counts hydrated from `User` rows. `filter` is rejected with 400 (`invalidFilter`); the group set is fixed so filter is meaningless.
- **GET /Groups/:id** — returns the group with members (id, fullName/email → `$ref: /scim/v2/Users/:id`).
- **PATCH /Groups/:id** — accepts `op: "add"` and `op: "remove"` on path `members` (and the Okta legacy form `members[value eq "userId"]`). Add sets `User.role` to the target group's role; remove downgrades the user to `VIEWER` (the least-privilege floor). Removing from the VIEWER group is a no-op (there is no lower role). Every effective change writes an audit entry.
- **PUT /Groups/:id** — full overwrite of the member set. The service diffs current vs desired membership, validates every desired id up-front (no partial mutation on a bad id), then applies adds and removes inside one transaction with the same audit + role-update semantics as PATCH.
- **POST /Groups** — returns **501 Not Implemented** (`scimType: notImplemented`). The group set is fixed by RBAC; IdPs cannot create a new role group.
- **DELETE /Groups/:id** — returns **501 Not Implemented** for the same reason.

The "remove → downgrade to VIEWER" choice is deliberate: every `User` row carries a non-null `role` column, so removing the role entirely isn't representable. VIEWER matches the create-time default in `scimToUserCreateInput` and our least-privilege bias. When a real Group/Team table lands (multi-team, scoped permissions), POST/DELETE become real implementations and this section is the canonical place to revisit the contract.

Out of scope for PR3: Okta E2E integration test (B3-PR4) and the `ServiceProviderConfig` / `ResourceTypes` / `Schemas` meta endpoints (B3-PR4).

#### Okta sandbox cert milestone (B3-PR4)

Black-box proof that the SCIM surface speaks the dialect Okta actually emits — not just the dialect our unit tests speak. Lives in [`apps/api/test/scim-okta-flow.e2e.spec.ts`](../apps/api/test/scim-okta-flow.e2e.spec.ts) and replays the full provisioning ceremony: `POST /Users` (with Okta-shaped extras: `externalId`, secondary emails, `phoneNumbers`, enterprise extension URN — all silently dropped by Zod), `GET /Users?filter=userName eq`, `GET /Users/:id`, `PATCH active=false` to deprovision, `GET /Groups` (the 5 synthetic role-derived entries), `PATCH /Groups/role:ADMIN` add + the Okta legacy `members[value eq "id"]` remove form, `DELETE /Users/:id` soft-delete. Security envelope: no Authorization header → 401, revoked token → 401, malformed `Bearer ` prefix → 401, tenant-B token attempting to read tenant-A users → empty list + 404 on direct id GET (multi-tenant RLS holding the line). Documented limitations exercised: complex Okta reconcile filters → 400 `invalidFilter`, `POST /Groups` → 501 `notImplemented`. Fixtures captured from Okta's published SCIM 2.0 Test App payloads in [`apps/api/test/fixtures/okta-scim-payloads.ts`](../apps/api/test/fixtures/okta-scim-payloads.ts). Operator runbook for wiring a real Okta sandbox tenant (token mint → app config → attribute map → group-to-role map → push test → troubleshooting + token rotation) lives in [`docs/SCIM_OKTA_SETUP.md`](./SCIM_OKTA_SETUP.md). No real Okta credentials are ever embedded — the runbook is reproducible against any free developer org.

#### Discovery surface (B3-PR5) — **B3 epic COMPLETE**

`scim-meta.controller.ts` + `scim-meta.fixtures.ts` add the five SCIM 2.0 discovery endpoints required by RFC 7644 §4. These are intentionally **public** (no `ScimBearerGuard`) because Okta / Azure AD probe them BEFORE the operator has pasted a bearer token into the wizard — gating them on auth breaks the preflight and fails several certification checks. The endpoints expose capability metadata only (no tenant data), so anonymous access is safe:

- `GET /scim/v2/ServiceProviderConfig` — declares: `patch.supported=true`, `filter.supported=true, maxResults=100`, `bulk.supported=false`, `changePassword.supported=false` (SSO-only), `sort.supported=false`, `etag.supported=false`, `authenticationSchemes=[oauthbearertoken]`.
- `GET /scim/v2/Schemas` + `GET /scim/v2/Schemas/:urn` — User + Group attribute schemas (RFC 7643 §8.7.1/§8.7.2 shapes; only attributes the /Users + /Groups handlers actually read are advertised).
- `GET /scim/v2/ResourceTypes` + `GET /scim/v2/ResourceTypes/:id` — binds `User` → `/Users` + User schema URN, `Group` → `/Groups` + Group schema URN.

After B3-PR5 the SCIM 2.0 surface is feature-complete: `/Users` CRUD (PR1), `/Groups` (PR2, synthetic + role-derived), bearer-token auth + admin surface (PR3), Okta integration test (PR4), discovery (PR5). Full RFC 7644 compliance for the implemented subset.

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
