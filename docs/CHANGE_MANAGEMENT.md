# Change Management Policy

Per SOC 2 CC8.1: changes to infrastructure + code are tracked, tested, approved.

Last updated: 2026-04-29 · v1.0

## Scope

This policy covers ALL changes to:
- Application code (api / web / shared)
- Database schema (Prisma migrations)
- Infrastructure as Code (Docker, Caddy)
- CI/CD configuration (.github/workflows/)
- Tenant-impacting feature flags
- Sub-processor changes

Out of scope: documentation typo fixes, internal scripts, content updates.

## Change classification

| Class | Examples | Required process |
|---|---|---|
| **Standard** | Bug fix, new feature, UI polish | PR → CI green → merge to main → deploy |
| **Significant** | Schema migration with data, new sub-processor, security control change | PR with extra reviewer + 24h notification + rollback plan |
| **Emergency** | Critical security patch, prod outage fix | Direct push to main with post-hoc PR + immediate notification |

## Standard change workflow

1. **Plan** in code or in `docs/` markdown if architectural
2. **Branch** `<type>/<short-description>` (e.g., `fix/auth-token-leak`)
   - Note: per CLAUDE.md rule #15, this project pushes directly to `main` until v1 launch — feature branches resume after launch
3. **Implement** with tests
4. **Local CI**: `pnpm lint && pnpm typecheck && pnpm test` must all pass
5. **Pre-commit hook** (husky) auto-blocks if lint/types fail on staged files
6. **Push** triggers GitHub Actions (lint+typecheck+test+secret-scan+pnpm-audit+OSV+CodeQL)
7. **Merge** when CI green
8. **Deploy** auto via Railway (when configured) or manual via /ship + /land-and-deploy
9. **Verify** via /canary post-deploy + monitoring dashboards

## Significant change additional requirements

- **Reviewer:** at least one other engineer (until solo, the "review" is /codex review or /review skill)
- **Notification:** email to all affected tenant OWNERs at least 24h in advance for tenant-impacting changes
- **Migration plan:** for schema changes, document in commit message:
  - What columns/tables changed
  - Backfill strategy (if data needs migration)
  - Rollback steps if migration fails
- **Rollback plan:** how to revert (git revert + migration down) and how long it takes

## Emergency change process

For P0 incidents (active breach, total outage):
1. Engineer fixes locally + tests
2. Direct push to main (skip PR review)
3. CI runs in parallel; deploy proceeds if tests pass
4. Within 24h: open retroactive PR documenting:
   - What broke
   - What the fix does
   - Why standard process was skipped
5. Within 7d: postmortem per docs/INCIDENT_RESPONSE.md

## Schema migration discipline (Prisma-specific)

Per CLAUDE.md rule + warn-prisma-schema hook:
1. Edit `apps/api/prisma/schema.prisma`
2. `pnpm --filter @amass/api exec prisma migrate dev --create-only --name <slug>` (NO --apply)
3. Inspect generated SQL in `prisma/migrations/<timestamp>_<slug>/migration.sql`
4. Verify:
   - Coloanele camelCase fără @map (or explicit @map snake_case dacă matches table convention)
   - RLS forțat pe noua tabelă (`ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`)
   - FK-urile cu `onDelete` explicit
   - Append-only revocations dacă datele sunt audit-grade
5. Apply locally: `pnpm exec prisma migrate dev`
6. Production deploy: `pnpm exec prisma migrate deploy` (only after staging verified)

## Sub-processor changes

Adding/changing a sub-processor requires:
1. Risk assessment vs existing DPIA (`docs/DPIA_TEMPLATE.md`)
2. SCC verification (must have or use EU-only)
3. Update `apps/web/src/routes/subprocessors.tsx` public list
4. Email notification to all OWNERs at least 30 days before change takes effect
5. Right of objection: tenants can object on reasonable grounds; we must offer alternative or termination

## Audit trail

All changes auto-tracked in:
- `git log` — full source history
- `audit_logs` table — all admin actions in app
- `webhook_deliveries` — all outbound notifications
- Sentry breadcrumbs (when DSN configured)
- Postmortem docs in `docs/postmortems/<date>-<slug>.md`

## Annual change management review

Once per year, OWNER reviews:
- Are emergency change process triggers happening too often (signal of fragility)?
- Are there standard changes that should require Significant treatment (e.g., always-fragile module)?
- Are sub-processor list changes following 30-day notice?

Manual process for now.
