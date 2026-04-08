# LESSONS.md — running log of mistakes, fixes & gotchas

> This file is maintained by Claude Code across sessions. Every time
> something breaks, surprises, or wastes time, add an entry here so
> future sessions don't repeat the mistake.
>
> **Format:** newest entries on top. Each entry should be short, factual,
> and actionable. Include the root cause, not just the symptom.

## How to add an entry

```markdown
### YYYY-MM-DD — short title
- **Sprint / area:** S1 / auth
- **Symptom:** what broke or surprised
- **Root cause:** why it happened
- **Fix:** what made it work
- **Lesson:** the rule to follow next time
```

## Categories to watch for

- **Multi-tenant leaks** — any query missing `tenantId` filter.
- **Migration drift** — schema changes not reflected in migrations.
- **Env var surprises** — missing/typo'd env at startup.
- **Docker pitfalls** — context paths, volume permissions, healthcheck timing, build cache.
- **Prisma gotchas** — N+1, transaction scope, middleware order.
- **TypeScript holes** — places we caught ourselves reaching for `any`.
- **Test flakes** — testcontainer startup races, port collisions.
- **Auth/security** — JWT mistakes, RLS bypass, presigned URL leakage.
- **Frontend state** — TanStack Query cache invalidation, race conditions.

---

## Entries

### 2026-04-08 — Sprint 7 — vitest fileParallelism + BullMQ workers don't mix
- **Sprint / area:** S7 / reminders / e2e tests
- **Symptom:** A new test that creates a reminder with `remindAt = now + 700ms`, then polls Postgres for `status = 'FIRED'`, passed in isolation (`vitest run test/reminders.e2e.spec.ts` → 908ms) but failed reliably when run as part of the full suite — the polling loop timed out at 4 seconds with the row still PENDING.
- **Root cause:** vitest defaults to file-parallel execution via a thread pool. Every test file imports `AppModule`, which registers a `RemindersProcessor` BullMQ worker subscribed to the shared `reminders` queue on Redis. When multiple files boot in parallel, you get N workers from N different `AppModule` instances all listening on the same queue. A job enqueued by the reminders test can be dispatched to a worker belonging to a *different* file's app — and that other app may already be tearing down (its `app.close()` runs at the end of its own `afterAll`), so the worker grabs the job and then the Prisma connection or BullMQ connection vanishes mid-process. The job either silently disappears or repeatedly errors out, never flipping the row to FIRED before the test gives up.
- **Fix:** Set `fileParallelism: false` in `apps/api/vitest.config.ts`. Test files now run sequentially, so exactly one set of workers per queue is alive at any moment. Total runtime for the full suite went from ~6s parallel to ~7s sequential — the parallelism wasn't buying us much because the tests are I/O-bound on the shared Postgres/Redis/MinIO anyway.
- **Lesson:** Any e2e suite that boots an `AppModule` containing BullMQ workers MUST run files sequentially. The shared infra (Postgres, Redis, MinIO) was already living dangerously under file-parallel execution — they only worked because each test file uses unique tenant slugs and unique storage keys. BullMQ, by contrast, has no per-test namespace knob: queue names are global to the Redis instance. Either run files sequentially, or namespace the queue per test process (e.g. `reminders-${process.pid}`), and the former is much simpler. Rule of thumb for this repo: **if a test file imports `AppModule`, treat the whole suite as sequential**.

### 2026-04-08 — Sprint 6 — `pnpm start` runs stale `dist/`, not source
- **Sprint / area:** S6 / curl verification
- **Symptom:** Brand new attachment routes were mapped in tests (vitest passes), but the curl verification against the running API got `404 NOT_FOUND: Cannot POST /api/v1/COMPANY/.../attachments/presign`. Stack trace pointed to `apps/api/dist/common/middleware/tenant-context.middleware.js`.
- **Root cause:** `apps/api/package.json` has `"start": "node dist/main.js"` (production-style). Vitest transpiles from `src/` on the fly, so tests reflect the latest code, but `pnpm start` boots whatever was last `nest build`'d into `dist/`. After adding new modules I forgot to rebuild.
- **Fix:** `pnpm build` before `pnpm start` (or use `pnpm dev` which is `nest start --watch` and reads `src/`).
- **Lesson:** For curl verification of fresh code, either (a) `pnpm build && pnpm start`, or (b) use `pnpm dev`. The fact that vitest was green proved nothing about the running API. Treat `pnpm start` as a deploy-mode command, not a dev-loop command.

### 2026-04-08 — Sprint 6 — Edit fails on files you haven't Read, even ones you just created via migrate
- **Sprint / area:** S6 / migrations + tooling
- **Symptom:** Tried to add RLS policies to a freshly-generated `prisma migrate dev` migration.sql file via Edit. Edit refused: "must Read first." Meanwhile `prisma migrate dev` had ALREADY applied the migration to the live DB without the RLS appended, leaving the new `attachments` table with RLS disabled in the running database.
- **Root cause:** Two compounding issues. (1) `prisma migrate dev` applies the migration immediately as it's generated, before I get a chance to inspect it. (2) The Edit tool requires a prior Read of any file in the session, even files Claude just observed appearing on disk via another command.
- **Fix:** (1) Read+Edit the file to add RLS for future fresh-installs / `migrate reset` runs. (2) Manually apply the missing RLS to the running database via `docker exec -i amass-postgres psql -U postgres -d amass_crm <<SQL ... SQL` so the live state matches what the migration file now says.
- **Lesson:** When using `prisma migrate dev` on a model that needs RLS, the RLS DDL must be inserted BEFORE the migration applies. Workflow:
  1. `prisma migrate dev --create-only` (generates the file but does NOT apply)
  2. Read + Edit the migration to append `ALTER TABLE … ENABLE/FORCE RLS`, `CREATE POLICY`, and `GRANT … TO app_user`
  3. `prisma migrate dev` (now applies the complete, RLS-aware migration)
  Without `--create-only` you'll always be playing catch-up against the live DB.

### 2026-04-08 — Sprint 4 — supertest EPIPE on guard-rejected multipart upload
- **Sprint / area:** S4 / importer / e2e tests
- **Symptom:** An e2e test that uploads a file with `.attach('file', path)` AND expects a 403 from `RolesGuard` failed with `Error: write EPIPE`. The other 32 tests passed; this one was the only one that combined a multipart body with a guard-level rejection.
- **Root cause:** NestJS execution order is **guards → interceptors → pipes → handler**. With `@UseGuards(RolesGuard)` plus `@UseInterceptors(FileInterceptor(...))`, the guard rejects the request and Nest writes the 403 response **before** multer (the FileInterceptor) starts reading the multipart body. The server then closes the socket while supertest is still streaming the file → broken pipe.
- **Fix:** Drop the `.attach()` from the test. Since the role check fires before the body is parsed, the test only needs to send the auth header and hit the route — no file required. Test asserts `expect(403)` and the 403 path is exactly what we want to cover.
- **Lesson:** Don't pair `.attach()` (or any large body) with assertions that rely on a guard-level rejection. Either:
  1. Verify the guard with a body-less request, OR
  2. Use a tiny in-memory buffer (`.attach('file', Buffer.from('a,b\n1,2\n'), 'tiny.csv')`) so the entire body fits in the TCP send buffer before the server closes.
  Knowing the Nest pipeline order (guards → interceptors → pipes → handler → response interceptors → exception filters) prevents this whole class of "why did supertest die" bugs.

### 2026-04-08 — Sprint 4 — BullMQ workers REQUIRE maxRetriesPerRequest: null
- **Sprint / area:** S4 / queue infra
- **Symptom:** Would have crashed at worker startup with: `Error: BullMQ: Your redis options maxRetriesPerRequest must be null.`
- **Root cause:** BullMQ v5 workers use blocking Redis commands (`BRPOPLPUSH`, etc). ioredis defaults `maxRetriesPerRequest: 20`, which means a blocked command in flight gets aborted after 20 retries — incompatible with workers that intentionally block forever waiting for jobs.
- **Fix:** Construct the connection explicitly in `QueueModule`:
  ```ts
  connection: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
  ```
  Share that one connection across all queues via `BullModule.forRootAsync`. Don't let `@nestjs/bullmq` auto-create per-queue connections without that flag.
- **Lesson:** The `maxRetriesPerRequest: null` constraint is BullMQ-specific and not obvious from the @nestjs/bullmq docs. Always construct the ioredis client yourself for BullMQ — don't pass a URL string and hope the defaults work.

### 2026-04-08 — Sprint 4 — TypeScript 6 deprecation: moduleResolution=node
- **Sprint / area:** S4 / tooling
- **Symptom:** `error TS5102: Option 'moduleResolution=node10' is deprecated and will stop functioning in TypeScript 7.0.` After upgrading to TS 6.0.2 the build wouldn't pass.
- **Failed attempts (don't repeat these):**
  1. `moduleResolution: "node16"` — requires explicit `.js` extensions in every relative import, would force a refactor of every `import { x } from './y'` in the codebase.
  2. `moduleResolution: "bundler"` — incompatible with `module: "commonjs"` (NestJS requires CJS at runtime).
  3. `ignoreDeprecations: "6.0"` while still on TS 5.9.3 → `error TS5103: Invalid value for '--ignoreDeprecations'` (5.9 only accepts `"5.0"`).
- **Fix:**
  1. Bumped `typescript` to `^6.0.2` in **both** `apps/api/package.json` AND `packages/shared/package.json` (workspace root must match per-package version or pnpm warns).
  2. Added `"ignoreDeprecations": "6.0"` to `apps/api/tsconfig.json` and `packages/shared/tsconfig.json`.
  3. TS 6 also tightened `tsconfig.build.json`: it now requires explicit `rootDir: "src"` (was previously inferred) — re-added it.
  4. Re-ran `pnpm --filter @amass/api prisma:generate` so the generated client matches the new TS version's stricter typings.
- **Lesson:** When fixing a deprecation warning, **upgrade the compiler before adding the silencer flag** — older TS versions don't recognise newer values for `ignoreDeprecations`. And when bumping a workspace tool like TypeScript, bump it in EVERY package.json that lists it as a devDep, not just the root.

### 2026-04-08 — Sprint 3 — workspace package must be built, not main:src/index.ts
- **Sprint / area:** S3 / monorepo / @amass/shared
- **Symptom:** Tests passed (vitest transpiles via SWC on the fly), but the production build crashed at runtime: `Cannot find module '/packages/shared/src/schemas/common'`. Node tried to load the raw `.ts` file imported from `index.ts`.
- **Root cause:** `packages/shared/package.json` had `"main": "src/index.ts"`. Vitest+SWC didn't care, but compiled NestJS code in `dist/` does — Node loads the JS, sees the import from `@amass/shared`, and follows the `main` field. Pointing main at a `.ts` file means Node has nothing to execute.
- **Fix:** Added `tsconfig.json` to `packages/shared`, `build` script (`tsc -p tsconfig.json`), set `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`. Build the shared package before building the API (turbo `^build` already orders this correctly).
- **Lesson:** Workspace packages used by built apps must compile to JS. `main: src/*.ts` only works when the consumer is also a TS-aware runtime (vitest, ts-node). The moment a `dist/` build runs the consumer, Node sees raw TS and dies.

### 2026-04-08 — Sprint 2 — RLS doesn't work for superusers (even with FORCE)
- **Sprint / area:** S2 / multi-tenant isolation
- **Symptom:** RLS policies + `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` were all in place. `SET LOCAL app.tenant_id = 'X'` was being applied (verified via `current_setting`). But cross-tenant `SELECT` still returned all rows. Inserts with wrong tenantId via `WITH CHECK` policy still succeeded.
- **Root cause:** Postgres **superusers and roles with `BYPASSRLS` always bypass RLS**, even when the table has `FORCE ROW LEVEL SECURITY` enabled. The default `postgres` user in the `pgvector/pgvector` image is a superuser. So all our policies were no-ops for the connection user.
- **Fix:**
  1. Created a non-superuser role `app_user` (`NOLOGIN NOSUPERUSER NOBYPASSRLS`) via migration `20260407211000_app_role`. Granted it CRUD on all tables + default privileges for future tables.
  2. Inside `PrismaService.runWithTenant`, added `SET LOCAL ROLE app_user` immediately after `SET LOCAL app.tenant_id`. This drops privileges for the rest of the transaction; reverted automatically at COMMIT/ROLLBACK. Migrations still run as `postgres` (need owner privileges for DDL), but data-plane queries run as `app_user` and obey RLS.
- **Lesson:** RLS in Postgres has THREE prerequisites and missing any one makes it silently a no-op:
  1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  2. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (otherwise the table owner bypasses it)
  3. **The connection user must NOT be SUPERUSER and must NOT have BYPASSRLS**
  Always verify with: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` If either is `t`, RLS is a lie.

### 2026-04-07 — Sprint 1 — decorator metadata trap (vitest + tsx)
- **Sprint / area:** S1 / NestJS bootstrap, tests
- **Symptom:** All NestJS controllers crashed with `TypeError: Cannot read properties of undefined (reading 'register')` — service was undefined inside controller. Same crash in vitest e2e and when running `tsx src/main.ts`.
- **Root cause:** Both `esbuild` (used by vitest) and `tsx` strip TypeScript decorator metadata. NestJS DI relies on `emitDecoratorMetadata` (`design:paramtypes` reflection) to resolve constructor parameters. No metadata → DI silently injects `undefined`.
- **Fix:**
  1. Vitest: added `unplugin-swc` + `@swc/core` and configured `swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })` in `vitest.config.ts`.
  2. Dev/runtime: do NOT use `tsx` for the API — use `tsc` (`tsconfig.build.json`) → `node dist/main.js`, or `nest start --watch`. Both emit metadata correctly.
- **Lesson:** Any TS project using NestJS / TypeORM / class-validator / typedi MUST use a transformer that emits decorator metadata. esbuild/tsx/swc-without-config will all break DI silently. Default to **swc with `decoratorMetadata: true`** or **tsc**. Never use `tsx` for NestJS app code.

### 2026-04-07 — Sprint 1 — express must be a direct dep for vitest
- **Sprint / area:** S1 / tests
- **Symptom:** `Failed to load url express` when vitest tried to compile `auth.controller.ts`.
- **Root cause:** `@nestjs/platform-express` re-exports express types, but Vite (used by vitest) does its own module resolution and doesn't follow the chain. Express was a transitive dep, not in `apps/api/package.json`.
- **Fix:** `pnpm --filter @amass/api add express @types/express`.
- **Lesson:** When vitest is used to test NestJS code, add `express` + `@types/express` as direct deps even though `@nestjs/platform-express` already pulls them in transitively.

### 2026-04-07 — Sprint 1 — tsconfig rootDir vs test folder
- **Sprint / area:** S1 / build config
- **Symptom:** `File 'test/auth.e2e.spec.ts' is not under 'rootDir' 'src'`.
- **Root cause:** `rootDir: "src"` conflicts with including `test/` files for type-checking.
- **Fix:** Removed `rootDir` from `tsconfig.json` (used for typecheck/tests). Added `tsconfig.build.json` that excludes `test/` and `*.spec.ts`, used by `tsc -p tsconfig.build.json` for the production build.
- **Lesson:** Two-tsconfig pattern (`tsconfig.json` for IDE/tests, `tsconfig.build.json` for `dist/`) is the standard NestJS layout. Don't fight it.

### 2026-04-07 — Sprint 0 bootstrap
- **Sprint / area:** S0 / repo skeleton
- **Symptom:** none yet — first commit.
- **Root cause:** n/a
- **Fix:** n/a
- **Lesson:** Decisions locked in S0 to remember:
  - **pgvector image** (`pgvector/pgvector:pg16`) instead of stock `postgres:16` — extension is preinstalled, no `CREATE EXTENSION` headache later.
  - **MinIO bucket auto-creation** uses a one-shot `minio/mc` sidecar (`minio-init`). It exits after running and is `restart: "no"` — that's intentional, do NOT change to `unless-stopped` or it loops forever.
  - **Caddyfile dev** has `auto_https off` — flipping this on locally hangs requests waiting for ACME.
  - **Dockerfiles for api/web** include placeholder build fallbacks (`|| true`, `|| echo …`) so `docker compose build` works even before real source exists. Remove these fallbacks once Sprint 1 lands real `main.ts` / `vite build` outputs — otherwise build failures will be silently masked.
  - **Compose env file:** must be invoked as `docker compose -f infra/docker-compose.yml --env-file .env up` from the repo root, OR via `pnpm docker:up` (which currently does NOT pass `--env-file`; defaults in compose cover dev). When real secrets land, switch the npm script to pass `--env-file ../.env` explicitly.
  - **`prisma generate` in API Dockerfile** is wrapped in `|| true` because the schema has no models in S0. Remove the `|| true` once Sprint 1 adds the first model.
