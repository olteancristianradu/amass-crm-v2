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
