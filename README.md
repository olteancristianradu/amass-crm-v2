# AMASS-CRM v2

Multi-tenant B2B+B2C CRM with deep voice intelligence (call transcription + AI analysis).
Romanian/EU SMB market. Solo-developer project — optimized for clarity, safety, simplicity.

## Status

**Sprint 0 / 20** — monorepo skeleton + Docker dev environment.
See [CLAUDE.md](./CLAUDE.md) for the full build brief and rules.
See [LESSONS.md](./LESSONS.md) for the running log of mistakes & fixes.

## Prerequisites

- **Docker** + Docker Compose v2
- **Node.js 22 LTS**
- **pnpm 9** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)

## Quick start

```bash
# 1. Copy env template
cp .env.example .env

# 2. Install JS deps (host-side, used by IDEs and local tooling)
pnpm install

# 3. Bring up the full dev stack
pnpm docker:up

# 4. Tail logs
pnpm docker:logs
```

## Services & ports

| Service     | URL                              | Notes                          |
|-------------|----------------------------------|--------------------------------|
| Caddy       | http://localhost                 | Reverse proxy (web + /api)     |
| API         | http://localhost:3000            | NestJS (Sprint 0 placeholder)  |
| Web         | http://localhost:5173            | React + Vite (placeholder)     |
| AI worker   | http://localhost:8000/health     | FastAPI                        |
| Postgres    | localhost:5432                   | user/pass: `postgres/postgres` |
| Redis       | localhost:6379                   |                                |
| MinIO API   | http://localhost:9000            | bucket: `amass-files`          |
| MinIO UI    | http://localhost:9001            | `minioadmin/minioadmin`        |

## Layout

```
apps/
  api/        NestJS backend
  web/        React frontend
  ai-worker/  Python FastAPI (Whisper / diarization / Presidio / Claude)
packages/
  shared/         Zod schemas, types, constants
  eslint-config/  Shared lint config
infra/
  docker-compose.yml
  caddy/Caddyfile
docs/
```

## Common commands

```bash
pnpm docker:up      # start stack
pnpm docker:down    # stop stack
pnpm docker:logs    # follow logs
pnpm lint           # lint everything (turbo)
pnpm test           # run all tests (turbo)
```

## Project rules

Read [CLAUDE.md](./CLAUDE.md) before contributing or asking Claude Code to make changes.
The non-negotiable rules (multi-tenant isolation, no `any`, tests required, etc.) live there.
