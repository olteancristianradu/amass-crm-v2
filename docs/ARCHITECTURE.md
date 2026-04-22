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

### Audit vs Activities

Two append-only streams, easy to confuse:

| | audit_logs | activities |
|-|-|-|
| Purpose | Security trail (who did what) | User-facing timeline feed |
| Mandatory? | Yes — failing to write is alarming | Best-effort — must NOT block the operation |
| Schema | `(actorId, action, subjectType, subjectId, ipAddress, userAgent, metadata)` | `(actorId, action, subjectType, subjectId, metadata)` |
| Read by | Future security console | Note/timeline endpoints in NotesController |

Both are tenant-scoped. Both are created from feature services (companies/contacts/clients/notes/attachments) on every mutation.

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
