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
