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

### 2026-04-28 — `@map` is the exception in this schema, not the rule
- **Sprint / area:** reports / raw SQL
- **Symptom:** `GET /reports/dashboard` returned 500 with `column d.stage_id does not exist`. Three of the five raw `$queryRaw` blocks in `ReportsService` referenced `tenant_id`, `created_at`, `deleted_at`, `stage_id`, `duration_sec` — and those columns don't exist; the actual columns are `tenantId`, `createdAt`, `deletedAt`, `stageId`, `durationSec`.
- **Root cause:** Most Prisma models in this repo do NOT use `@map`. Postgres stores the column with the camelCase identifier and requires it to be quoted: `"tenantId"`. There are exceptions: `invoices`, `email_tracking`, `webhook_deliveries` etc. *do* use `@map`. The reports service mixed both worlds in the same file, which made the inconsistency hard to spot during code review.
- **Fix:** Replaced snake_case with `"camelCase"` in every query that hits a non-`@map` table; left the `invoices` queries as-is (they correctly use snake_case). Verified post-fix with a live `GET /reports/dashboard` returning 200.
- **Lesson:** Before writing raw SQL against any table in this repo, run `\d <table>` against the live Postgres or grep the schema for `@@map(` and `@map(` on the model — never assume snake_case. When mixing camelCase and snake_case columns in the same file, add an inline comment marking the non-default convention so the next reader doesn't have to reconstruct it.

### 2026-04-28 — Stale `dist/` in running container after a host build
- **Sprint / area:** dev loop / docker
- **Symptom:** Edited `reports.service.ts`, ran `pnpm --filter @amass/api build` (which writes to `apps/api/dist/` on the host), restarted the container — the fix didn't take effect. Container was still running the old `dist/` baked in at image-build time.
- **Root cause:** `apps/api/Dockerfile` does `COPY apps/api ./apps/api` and then `pnpm --filter @amass/api build` *inside the build stage*, so the running container's `dist/` is whatever the image was built with. Restarting just re-execs the same image.
- **Fix:** `docker cp apps/api/dist amass-api:/repo/apps/api/` then `docker compose restart api`. (Long-term: add a dev compose override that bind-mounts `apps/api/src/` and runs `nest start --watch` instead of `node dist/main.js`.)
- **Lesson:** When a host build doesn't show up in the container, the answer is `docker cp` (fast) or rebuild the image (slow). Both beat 30 minutes of "but I rebuilt it" debugging.

### 2026-04-28 — Cedar policy decorator pattern, mass-add edition
- **Sprint / area:** access-control / 19 controllers in one push
- **Symptom:** Cedar coverage on Nest controllers stuck at 18/64 because nobody wanted to write the same `@RequireCedar({...})` block 50 times.
- **Root cause:** It looked like adding Cedar required (a) editing the module to import `AccessControlModule`, (b) editing the controller to import the guard + decorator + add to `@UseGuards`, (c) editing every write/delete handler. The module step is the one that made it feel heavy.
- **Fix:** `AccessControlModule` is `@Global()` — module imports are NOT needed. Adding Cedar is just (b) + (c) per controller. With that realisation, mass-rolled out across 14 controllers / 62 handlers via a delegated agent task, then verified `pnpm lint && tsc --noEmit` clean.
- **Lesson:** When a code pattern looks expensive to roll out, check what's actually required vs. what the docs say is required. `@Global()` on a module turns "edit N modules" into "edit N controllers" — sometimes that 2× difference is what unblocks a whole quality improvement.

### 2026-04-27 — Hallucinated GitHub Action SHA broke CI
- **Sprint / area:** CI / dependency hygiene
- **Symptom:** Daily workflow failed with `Unable to resolve action zaproxy/action-baseline@4ca41f5d416ba7c0a5e1c84a3ff9ec8efd34ee3a, unable to find version`. The pin claimed to be `# v0.12.0` but the SHA didn't exist in the upstream repo.
- **Root cause:** A previous session inserted a fabricated 40-char hex SHA next to a real version tag comment. Reviewers see `# v0.12.0`, trust the comment, miss that the hash is wrong. GitHub Actions only fetches by SHA, so the comment is documentation only — there is no verification step.
- **Fix:** `git ls-remote https://github.com/zaproxy/action-baseline.git` lists every real ref (`refs/tags/v0.14.0` → `7c4deb10e6261301961c86d65d54a516394f9aed`). Repinned to that verified SHA + bumped to v0.14.0 since we touched the line anyway.
- **Lesson:** When pinning third-party Actions to a SHA, verify the SHA exists upstream — never type one in from memory or trust a "v0.x.x" comment without `git ls-remote` proof. The real SHA after `^{}` (dereferenced tag) is the canonical commit hash to pin.

### 2026-04-27 — `react-hooks/set-state-in-effect` blocks `setX()` inside useEffect
- **Sprint / area:** web / lint
- **Symptom:** ESLint flagged `setQuery('')`, `setDebounced('')`, `setHighlighted(0)` inside a `useEffect(() => { if (open) {...} }, [open])` reset block, and `setHighlighted(0)` inside a clamp effect.
- **Root cause:** React 19 + the `react-hooks` plugin now treats `setState()` calls in an effect body as a code smell — they cause cascading re-renders that the effect was supposed to avoid.
- **Fix:** Two patterns:
  1. **Mount-time reset:** split `<CommandPalette>` (gates on `open`) from `<PaletteBody>` (owns the state). When `open` flips false→true the outer remounts the body fresh, so default state is automatic — no reset effect needed.
  2. **Clamp inline:** instead of an effect that clamps `highlighted` when rows shrink, derive the clamped value on every render: `const highlighted = rows.length === 0 ? 0 : Math.min(highlightedRaw, rows.length - 1)`.
- **Lesson:** Don't reach for `useEffect(() => setState(default), [trigger])` — either remount via a parent gate or derive inline. Effects are for syncing with external systems; React state should be derived or initialised directly.

### 2026-04-27 — `vi.fn()` cast to a real interface loses `.mock` access
- **Sprint / area:** api / tests
- **Symptom:** `Property 'mock' does not exist on type '(entry: AuditEntry) => Promise<void>'` when reading `h.audit.log.mock.calls[0]` in a service spec.
- **Root cause:** The test stub is `{ log: vi.fn() } as unknown as ConstructorParameters<typeof Service>[1]`. The cast erases the `vi.Mock` wrapper from the type — TS sees only the real signature, which doesn't have `.mock`.
- **Fix:** Wrap with `vi.mocked(h.audit.log).mock.calls[0][0]`. Vitest's `vi.mocked()` is exactly this: it asserts at the type level that the function is a mock without changing runtime behaviour.
- **Lesson:** When you cast a mock to a typed constructor parameter, you give up direct `.mock` introspection on that handle. Reach for `vi.mocked()` whenever you need to inspect call args after a cast.

### 2026-04-27 — Prisma model FK without inverse relation: tx.deal.company doesn't exist
- **Sprint / area:** api / prisma
- **Symptom:** `tx.deal.findMany({ select: { ..., company: { select: { name: true } } } })` typechecked at runtime but TS errored: `Property 'name' does not exist on type 'never'`.
- **Root cause:** `Deal` has `companyId String?` but no `company Company? @relation(...)` inverse — only `pipeline` and `stage` relations are declared. Prisma generates `companyId` as a foreign-key column without the navigation property, so `select: { company: ... }` resolves to `never`.
- **Fix:** Two-step query — fetch `companyId` on the deal, then `tx.company.findMany({ where: { id: { in: companyIds } } })` and join in JS via a `Map`.
- **Lesson:** When adding a Prisma include/select for a relation, double-check that the inverse exists in `schema.prisma`. A bare FK column without `@relation(...)` won't surface as a navigable property even if the column itself is queryable.

### 2026-04-27 — Coverage push: the right unit-spec skeleton for service-level tests
- **Sprint / area:** api / test patterns
- **Symptom:** Inconsistency across early specs — some used `runWithTenant(tenantId, fn)` (2-arg), some `runWithTenant(tenantId, level, fn)` (3-arg), some forgot to mock side-effect deps (audit, embedding, workflows).
- **Fix / pattern:** Every new service spec uses this `build()` skeleton:
  ```ts
  vi.mock('../../infra/prisma/tenant-context', () => ({
    requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
  }));
  function build() {
    const tx = { /* every Prisma model the service touches */ };
    const prisma = {
      runWithTenant: vi.fn(async (
        _id: string,
        levelOrFn: string | ((t: typeof tx) => unknown),
        fn?: (t: typeof tx) => unknown,
      ) => (typeof levelOrFn === 'function' ? levelOrFn : fn!)(tx)),
    } as unknown as ConstructorParameters<typeof Service>[0];
    // …mock audit / activities / embedding / workflows / queue identically
  }
  ```
  The dual-overload `runWithTenant` mock means tests work whether the service calls the 2-arg or 3-arg form. Pattern shipped: `companies`, `contacts`, `clients`, `contracts`, `contact-segments`, `forecasting`, `duplicates`, `tasks`, `email`, `workflows`, `totp`, `brief`.
- **Lesson:** Standardise the spec scaffold across services so coverage rounds compose without rewriting boilerplate; keep the dual-arity `runWithTenant` mock so a service refactor between read-only and read-write paths doesn't break specs.

### 2026-04-25 — Schema drift: prisma migrate diff is correct, generate USING casts by hand
- **Sprint / area:** infra / prisma
- **Symptom:** CI `prisma-drift` job failed on `main` with ~100 diff entries — 14 missing enum types, dozens of TEXT→enum conversions, index renames, and FK redefinitions.
- **Root cause:** A previous session edited `schema.prisma` (commit `150d50d` "refactor: close remaining tech debt") without running `prisma migrate dev`, so the schema declared things that no migration created. CI runs `prisma migrate diff --from-migrations --to-schema-datamodel` which correctly detected the gap.
- **Fix:** `pnpm exec prisma migrate diff --script` produces a draft, but its `DROP COLUMN + ADD COLUMN` for enum conversions DESTROYS DATA. Hand-craft the migration replacing each pair with `ALTER COLUMN <col> TYPE <Enum> USING (<col>::text::<Enum>)`. Tested on a real Postgres+pgvector shadow DB with seed data — every row survived. Migration: `20260424100000_schema_catchup`.
- **Lesson:** (1) Never edit `schema.prisma` without immediately running `prisma migrate dev` — drift compounds quickly. (2) When generating a catch-up migration, always start from `--script`, then audit for destructive `DROP COLUMN` + replace with `ALTER COLUMN ... TYPE ... USING`. Postgres TEXT→enum casts via USING preserve data when values match enum variants; if they don't, the migration fails loud (correct behaviour, not silent data loss).

### 2026-04-25 — Prisma `UNIQUE(...)` constraint vs UNIQUE INDEX — Prisma diff treats them as different
- **Sprint / area:** infra / prisma
- **Symptom:** Catch-up migration applied cleanly but rerunning `prisma migrate diff` still flagged `[+] Added unique index` on `forecast_quotas` and `formula_fields`.
- **Root cause:** Earlier hand-written migrations declared `UNIQUE(tenant_id, ...)` as a TABLE CONSTRAINT inside `CREATE TABLE`. Postgres exposes this as a `CONSTRAINT` object plus an auto-generated index. Prisma's `@@unique([...])` schema annotation expects a standalone `UNIQUE INDEX`; even though the column list and name match, Prisma's diff sees them as different object kinds.
- **Fix:** In the catch-up migration, drop the constraint and recreate as a unique INDEX with the same name: `ALTER TABLE x DROP CONSTRAINT x_..._key; CREATE UNIQUE INDEX x_..._key ON x(...)`.
- **Lesson:** Never use inline `UNIQUE(col1, col2)` in a `CREATE TABLE` for columns that have a Prisma `@@unique([...])` annotation. Always emit `CREATE UNIQUE INDEX <name> ON <table>(...)` so Prisma's view of the DB matches its view of the schema.

### 2026-04-25 — vi.mocked() doesn't infer types when the wrapped object is cast to PrismaService
- **Sprint / area:** testing / vitest
- **Symptom:** `vi.mocked(h.prisma).call.findFirst.mockResolvedValue(...)` failed typecheck with "Property 'mockResolvedValue' does not exist" on the Prisma delegate.
- **Root cause:** `h.prisma` is built as a plain object literal cast to `PrismaService` via `as unknown as ConstructorParameters<...>[0]`. `vi.mocked()` only re-types objects that came directly from a `vi.mock()` factory — when the input is a cast, it sees the static Prisma client type, not the underlying mock.
- **Fix:** Hold separate references to the mock objects in the test helper (`prismaPhone = { findFirst: vi.fn() }`) and assign them onto the prisma stub. Test code drives `h.prismaPhone.findFirst.mockResolvedValue(...)` directly — typed as `Mock`, no `vi.mocked()` needed.
- **Lesson:** When stubbing PrismaService for unit tests, expose the mock spies at the top level of the build helper. Don't try to reach through `vi.mocked(svc)` into a deeply-typed Prisma delegate.

### 2026-04-25 — Adding a new middleware breaks every existing supertest call that didn't know about it
- **Sprint / area:** testing / e2e
- **Symptom:** `auth.e2e.spec.ts` started returning 403 CSRF_HEADER_MISSING on `/auth/refresh` and `/auth/logout` after `CsrfHeaderMiddleware` shipped.
- **Root cause:** The new middleware required `X-Requested-With: amass-web` on mutative cookie-authenticated requests. Existing supertest calls didn't set the header.
- **Fix:** Add `.set('X-Requested-With', 'amass-web')` to every mutative call in the affected spec, mirroring what the real SPA does.
- **Lesson:** When adding a guard or middleware that requires a new request header, immediately grep the test suite for handlers under that route and fix them in the same commit. Otherwise the next CI run is red and the cause looks unrelated.

### 2026-04-19 — Formula evaluator: use recursive descent, never eval/new Function
- **Sprint / area:** Tier B / formula-fields
- **Symptom:** Nevoie de expresii calculate definite de tenant ("MRR * 12", "CONCAT(firstName, ' ', lastName)") fără risc de code injection.
- **Root cause:** `eval()` sau `new Function()` permit execuție arbitrară de cod în contextul serverului.
- **Fix:** Parser recursive descent manual: tokenizer → parseExpr → parseTerm → parseFactor → callBuiltin. Whitelist de built-ins (CONCAT, IF, UPPER, LOWER, LEN, NUMBER, ROUND). Variabilele sunt lookup în `context` map, nu în scope global.
- **Lesson:** Orice sandbox de expresii definit de utilizator în Node.js TREBUIE să evite `eval`/`Function`. Recursive descent cu whitelist este simplu, testabil și suficient pentru formulele CRM.

### 2026-04-19 — catch(e) unused var triggers ESLint @typescript-eslint/no-unused-vars
- **Sprint / area:** Tier B / territories
- **Symptom:** `catch (e)` unde `e` nu este folosit dă eroare lint.
- **Root cause:** `@typescript-eslint/no-unused-vars` include și parametrii catch.
- **Fix:** Folosit `catch {` (fără parametru) — sintaxă validă în ES2019+/TS.
- **Lesson:** Când vrei să ignori eroarea din catch, scrie `catch {` nu `catch (_e)` sau `catch (e)`.

### 2026-04-19 — SLA escalation via raw SQL cu enum cast Postgres
- **Sprint / area:** Tier B / cases
- **Symptom:** `$executeRaw` cu cast la enum Prisma (`"CasePriority"`) necesită ghilimele duble în SQL Postgres.
- **Root cause:** Enum-urile Prisma sunt tipuri Postgres cu majuscule; cast via `::` necesită exact `"CasePriority"` cu ghilimele (case sensitive).
- **Fix:** `${next}::"CasePriority"` în template literal `$executeRaw`.
- **Lesson:** La cast enum Postgres în raw SQL, folosește întotdeauna ghilimele duble: `'WON'::"DealStatus"`.

### 2026-04-19 — PWA service worker must NOT cache /api/ requests
- **Sprint / area:** Tier B / PWA
- **Symptom:** Risc de leak multi-tenant dacă service worker-ul cache-uiește răspunsuri API între utilizatori (alt tenant primește date altui tenant din cache).
- **Root cause:** Default fetch interception cache-uiește toate GET requests; combinat cu JWT-uri per-tenant, două sesiuni pot returna răspunsul greșit.
- **Fix:** Service worker (`apps/web/public/sw.js`) verifică `url.pathname.startsWith('/api/')` și face skip → mereu network. Doar app shell-ul (HTML, manifest, icons) este cache-uit.
- **Lesson:** Pentru PWA în context multi-tenant + auth, NU intercepta cereri API. Cache-uiește doar resurse statice publice fără semnificație tenant-specifică.

### 2026-04-19 — Auto-numbered records (Cases, Orders) need findFirst orderBy desc, not COUNT
- **Sprint / area:** Tier B / Cases & Orders
- **Symptom:** Două creates concurente pot primi același număr dacă folosim `count() + 1`.
- **Root cause:** `count()` nu blochează rândurile inserate concurent; race condition între tx-uri.
- **Fix:** Folosit `findFirst({ orderBy: { number: 'desc' } })` apoi insert. UNIQUE constraint `(tenant_id, number)` garantează că un duplicat va eșua și aplicația poate retry. Tx-ul fiind serializabil sub `runWithTenant` reduce probabilitatea conflictului.
- **Lesson:** Pentru numere secvențiale per-tenant, combină `findFirst` (cel mai mare) cu UNIQUE constraint. Dacă volumul crește, migrează la sequence Postgres dedicat per tenant sau lock advisory.

### 2026-04-19 — Shared package export conflict: LeadSourceSchema duplicate
- **Sprint / area:** S53 / Leads / shared schemas
- **Symptom:** TypeScript error `Module './schemas/company' has already exported a member named 'LeadSourceSchema'`. Both `company.ts` and `leads.ts` exported it.
- **Root cause:** Agent-generated `leads.ts` redeclared the enum instead of importing from `company.ts` where it already existed (LeadSource was originally defined for Company).
- **Fix:** Removed duplicate declaration from `leads.ts`, added `import { LeadSourceSchema } from './company'` and re-exported it.
- **Lesson:** Before adding an enum to a new schema file, grep shared/schemas/ for existing exports with the same name. In this codebase, `LeadSource` lives in `company.ts` and is shared.

### 2026-04-19 — vitest mock order wrong for Promise.all calls
- **Sprint / area:** S53 / lead-scoring spec
- **Symptom:** `mockRunWithTenant` mock consumed in wrong order → wrong values in service, tests failed.
- **Root cause:** `gatherFactors()` uses `Promise.all([activities, calls, emailMessages, deals])` for 4 of the 6 calls. For `entityType='company'`, `emailMessages` resolves via `Promise.resolve(0)` (not `runWithTenant`), so only 3 calls in the Promise.all. The spec had an extra mock for email.
- **Fix:** Reordered spec mocks: exists → activities → calls → deals → lastActivity → upsert (6 calls, not 7).
- **Lesson:** When mocking sequential + parallel async calls, map the ACTUAL code path. `Promise.all` does NOT change the `mockResolvedValueOnce` consumption order but skipped branches (like `Promise.resolve(0)` shortcircuits) DO reduce the call count.

### 2026-04-19 — ESLint `no-explicit-any` blocks test spec files
- **Sprint / area:** S53+ / tests / ESLint
- **Symptom:** `pnpm lint` failed with 13 errors — `as any` in mock object casts in spec files.
- **Root cause:** `eslint.config.mjs` applied `no-explicit-any: error` globally, including `*.spec.ts`.
- **Fix:** Added ESLint override for `**/*.spec.ts` files relaxing `no-explicit-any: off`.
- **Lesson:** Partial mock objects in test files legitimately need `as any` (or `as unknown as Type`). Add the test file override from the start, not after the fact.

### 2026-04-19 — CI MinIO duplicate: service container + step on same port 9000
- **Sprint / area:** S47–S55 / CI / MinIO
- **Symptom:** CI e2e job likely failing because both a `services: minio:` container and a `Start MinIO` step tried to bind port 9000 simultaneously.
- **Root cause:** The MinIO service container was added when the MinIO step was already present; both got merged into the same branch during a non-fast-forward merge.
- **Fix:** Removed the `services: minio:` section (health check uses `curl` which isn't in the MinIO image anyway). Kept only the explicit Docker `run` step.
- **Lesson:** MinIO's healthcheck requires curl which is NOT in the official MinIO image. Use a step with `docker run` + manual `until curl` wait instead of a service container.

### 2026-04-17 — CI — JwtAuthGuard DI failures repeat across multiple modules (reactive vs upfront audit)
- **Sprint / area:** S15–S16 / CI / module wiring
- **Symptom:** CI kept failing with a cascade: `Nest can't resolve dependencies of the JwtAuthGuard (?). Please make sure that the argument JwtService at index [0] is available in the XModule context.` → app couldn't bootstrap → ALL 13 e2e specs failed with `TypeError: Cannot read properties of undefined (reading 'tenant')` in `afterAll` (because `prisma` was never assigned in `beforeAll`).
- **Root cause:** Multiple new late-sprint modules (`EmailSequencesModule`, `ContactSegmentsModule`, `QuotesModule`) were scaffolded without importing `AuthModule`. Because I fixed them one at a time as CI revealed them, three separate CI runs failed with essentially the same bug. Each fix only unmasked the next one.
- **Fix:** Comprehensive upfront grep: `for each module dir, if controller uses JwtAuthGuard/UseGuards and module doesn't import AuthModule/JwtModule → flag`. Then fix ALL in one commit.
- **Lesson 1:** When a pattern like "module missing AuthModule" surfaces, **immediately audit every module** — don't fix one and push. The effort of a 10-line shell loop saves 3+ CI run cycles.
- **Lesson 2:** The `prisma undefined in afterAll` error is always a **secondary symptom** of app bootstrap failure. Don't chase it directly — find the root bootstrap error first.
- **Lesson 3:** Whenever creating a new NestJS module with a protected controller: always add `AuthModule` to `imports[]` on the spot, before committing. Treat it as a checklist item alongside creating the service/controller files.
- **Lesson 4:** The AuditModule fix was special: `AuditModule` → `AuthModule` → `AuditModule` = circular. Solution: import `JwtModule.registerAsync()` directly in `AuditModule` instead of `AuthModule`. For all non-circular cases, import `AuthModule`.

### 2026-04-17 — CI — migration column name mismatch (camelCase vs snake_case in index DDL)
- **Sprint / area:** S15–S16 / CI / migrations
- **Symptom:** `column "tenant_id" does not exist` during `prisma migrate deploy` in CI. The `attachments` table had been created with `"tenantId"` (camelCase, no `@map`) but a later migration's `CREATE INDEX` referenced `"tenant_id"` (snake_case).
- **Root cause:** Hand-written migration SQL for a new index copy-pasted the conventional snake_case column name without checking how the original migration created the column.
- **Fix:** Changed the index to use `"tenantId"` (matching the actual column name in the DB).
- **Lesson:** Before writing any hand-crafted DDL that references existing columns, check the original migration or `\d tablename` to see exact column names. This repo does NOT use `@map` on most fields, so column names are camelCase in Postgres. Don't assume snake_case.

### 2026-04-14 — S20/S21 — NestJS module-level loadEnv() breaks test bootstrap
- **Sprint / area:** S20/S21 / test infrastructure
- **Symptom:** `pnpm test` failed with `Environment validation failed — ENCRYPTION_KEY: Required` even though `globalSetup` was loading the `.env` file. The env vars were present in the setup process but not in the worker processes that actually import NestJS modules.
- **Root cause:** `auth.module.ts` called `const env = loadEnv()` at **module evaluation time** (top-level, outside any function). When vitest workers import `AppModule` → `AuthModule`, the module-level code runs before `setupFiles` can inject env vars. The `globalSetup` runs in the main process; env vars set there do NOT propagate to worker processes.
- **Fix:** Changed `JwtModule.register({ secret: env.JWT_SECRET })` to `JwtModule.registerAsync({ useFactory: () => { const env = loadEnv(); return { ... }; } })`. The factory runs lazily when the DI container is actually built, by which time `setupFiles` has already set the env vars in the worker process.
- **Lesson:** Never call `loadEnv()` (or any Zod-validated env schema) at module level in NestJS. Always lazy-load inside `useFactory` / `useClass` / provider factories. Module-level code runs at import time, before any test setup can run. This applies to any side-effectful initialization: DB connections, external clients, etc.

### 2026-04-14 — S20/S21 — Prisma @map required when migration uses snake_case
- **Sprint / area:** S21 / Workflow models
- **Symptom:** `PrismaClientKnownRequestError: The column 'workflows.tenantId' does not exist in the current database`. Prisma generated JS used `tenantId` but the actual DB column (from the migration SQL) was `tenant_id`.
- **Root cause:** Prisma schema models used camelCase field names (`tenantId`, `isActive`, etc.) without `@map("snake_case")` annotations. The migration SQL (written manually) used snake_case column names. Prisma's generated client uses the schema field names, not the DB column names — so there was a permanent mismatch.
- **Fix:** Added `@map("tenant_id")`, `@map("is_active")`, etc. to every camelCase field in `Workflow`, `WorkflowStep`, and `WorkflowRun` models. Then ran `npx prisma generate` to regenerate the client.
- **Lesson:** When writing a migration SQL by hand AND using camelCase field names in the schema, you must add `@map("snake_case")` to every field. Alternatively, let `prisma migrate dev` generate the SQL (it respects `@map` automatically). Mixing hand-written SQL with a schema that lacks `@map` annotations always leads to this mismatch.

### 2026-04-14 — S20/S21 — AuthModule must be imported in every module using JwtAuthGuard
- **Sprint / area:** S21 / DI / module wiring
- **Symptom:** `Nest can't resolve dependencies of the JwtAuthGuard (?). Please make sure that the argument JwtService at index [0] is available in the ReportsModule context.`
- **Root cause:** `JwtAuthGuard` depends on `JwtService`, which is provided by `JwtModule` inside `AuthModule`. Any NestJS module whose controllers use `@UseGuards(JwtAuthGuard)` must import `AuthModule` to make `JwtService` visible in that module's DI context. Six later-sprint modules (ai, calls, email, gdpr, reports, workflows) were missing this import.
- **Fix:** Added `AuthModule` to the `imports` array in all six modules.
- **Lesson:** Every module that uses JWT-protected routes MUST import `AuthModule`. This is easy to miss when creating new modules — add it as a checklist item when wiring up a new controller with `@UseGuards(JwtAuthGuard)`. Consider making `AuthModule` `@Global()` to avoid this repetition (trade-off: implicit vs explicit dependency).

### 2026-04-14 — S20/S21 — z.string().min(1) rejects empty strings from .env
- **Sprint / area:** S21 / env validation
- **Symptom:** `ZodError: ANTHROPIC_API_KEY: String must contain at least 1 character(s)` when `.env` has `ANTHROPIC_API_KEY=` (empty value).
- **Root cause:** An empty value in `.env` is parsed as an empty string `""`, not as `undefined`. `z.string().min(1).optional()` passes on `undefined` but rejects `""`. Devs commonly leave optional keys blank in `.env` files.
- **Fix:** Wrapped each optional key with `z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())` to convert empty strings to `undefined` before Zod validates.
- **Lesson:** For optional env vars, always use `z.preprocess` to coerce `""` → `undefined`. The pattern `z.string().min(1).optional()` is not sufficient when env files may contain `KEY=` (blank value). This applies to any env var that is optional but must be non-empty if provided.

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
