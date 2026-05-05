# Contributing to AMASS CRM

Thanks for considering a contribution. This is a solo-dev project today, so the bar for contributions is "useful and well-tested" rather than "follows our 30-page style guide."

## Before you start

1. Read [`AGENTS.md`](./AGENTS.md) — it's the authoritative working rules for the codebase. Both humans and AI agents follow it.
2. Read [`CLAUDE.md`](./CLAUDE.md) — the condensed architectural ruleset.
3. Skim [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — setup, monorepo structure, and conventions.

## Quick start

```bash
git clone https://github.com/olteancristianradu/amass-crm-v2.git
cd amass-crm-v2
pnpm install
docker compose -f infra/docker-compose.yml up -d
docker exec amass-api pnpm exec prisma migrate deploy
docker exec amass-api pnpm exec prisma db seed
```

Login at `http://localhost` with `admin@amass-demo.ro` / `AmassCRM2026!`.

## Required checks before opening a PR

```bash
pnpm lint        # ESLint across all packages
pnpm typecheck   # TypeScript --noEmit
pnpm test        # Vitest unit tests
```

For the API specifically:

```bash
pnpm --filter @amass/api lint
pnpm --filter @amass/api typecheck
pnpm --filter @amass/api test
# If you touched DB schema:
pnpm --filter @amass/api exec prisma migrate dev
# If you touched a controller/service, run focused e2e:
pnpm --filter @amass/api exec vitest run test/<your-area>.e2e.spec.ts
```

For the web app:

```bash
pnpm --filter @amass/web lint
pnpm --filter @amass/web typecheck
pnpm --filter @amass/web test
```

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/). Examples:

- `feat(deals): add Kanban drag-drop`
- `fix(auth): refresh token rotation race condition`
- `docs(readme): clarify ANAF setup steps`
- `chore(deps): bump axios to 1.16.0`

For security fixes, prefix with `fix(security):` and reference the SEC-N tracker ID:

- `fix(security): SEC-005 notifications gateway uses CORS allow-list and tid claim`

## What to work on

- Open issues labeled `good first issue` or `help wanted`.
- Anything in [`UNFINISHED.md`](./UNFINISHED.md) marked `open` and not `blocked`.
- Test coverage gaps — see modules without `.spec.ts` files.
- Romanian-specific verticals (ANAF, eMag, Termene.ro integrations).

## What NOT to do

- Don't add Kafka, Kubernetes, microservices, GraphQL, MongoDB, Redux, or Meilisearch. See [`CLAUDE.md`](./CLAUDE.md) for why and when those become unblocked.
- Don't add features without an issue describing the use case.
- Don't bypass multi-tenancy — every Prisma query must run inside `runWithTenant()` or filter by `tenantId` manually.
- Don't commit secrets. The repo runs `gitleaks` on every push.
- Don't use `--no-verify` to skip pre-commit hooks. If a hook fails, fix the underlying issue.

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. Email `cristian.raduoltean@gmail.com` directly. We'll respond within 7 days.

## License

By contributing, you agree your contributions will be licensed under [AGPL-3.0](./LICENSE).
