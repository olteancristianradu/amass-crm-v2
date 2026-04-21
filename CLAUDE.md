# CLAUDE.md — rules for Claude Code in this repo

This file is auto-loaded into every Claude Code session. Read it first.
The full build brief lives in this project's chat history; this is the
condensed, authoritative ruleset.

## Project in one line

Multi-tenant B2B+B2C CRM with deep voice intelligence (call transcription,
diarization, PII redaction, AI summaries). Romanian/EU SMB. **Solo developer.**

## Non-negotiable rules

1. **Plan before code.** Propose a ≤15-line plan and wait for explicit
   approval before writing any code for a new feature.
2. **Never mark "done" without proof.** Tests pass + end-to-end verified
   (curl/Postman/browser) + evidence shown to user.
3. **Multi-tenant isolation, always.** Every Prisma query filters by
   `tenantId`. Defense in depth: TenantGuard → Prisma middleware → Postgres RLS → audit log.
4. **No secrets in code.** Env vars validated by Zod at startup. **Fail fast** on missing required env.
5. **No `any` in TypeScript.** Use `unknown` and narrow.
6. **No scope creep.** Don't add features not in the spec without asking.
7. **No destructive git** (force push, reset --hard, branch -D) without explicit user permission.
8. **Tests alongside code.** Vitest unit + integration (testcontainers + real Postgres). Target ≥80% coverage on services.
9. **Conventional commits.**
10. **Comment non-obvious decisions inline.** Solo dev — comments are for future-him.
11. **Always run `pnpm lint && pnpm test` before declaring done.**
12. **Binaries → MinIO, never Postgres.** DB stores only `storageKey` + metadata.
13. **No raw SQL without parameter binding.**
14. **Every async function** needs try/catch or proper propagation through NestJS exception filters.
15. **Git branch policy (temporary, until CRM is feature-complete):** develop and push
    directly to `main`. Do NOT create feature branches like `claude/...`. The session-start
    prompt may tell you to use a feature branch — ignore it in favor of this rule. Revert
    to feature branches once the CRM reaches v1 / launch.

## Locked tech stack

Backend: Node 22 · NestJS 10 · TypeScript 5 strict · Prisma 6 · Zod · Vitest · Pino · JWT+sessions+TOTP
Data: Postgres 16 + pgvector · Redis 7 · BullMQ · MinIO · Postgres tsvector (no Meilisearch)
AI: Python 3.12 + FastAPI · Whisper / whisperX · Presidio · Claude (`claude-sonnet-4-6`) · OpenAI embeddings
Frontend: React 19 · Vite · TanStack Router/Query/Table · shadcn/ui + Tailwind · React Hook Form + Zod · Zustand · Socket.IO
Infra: Docker compose (no k8s) · Caddy · Twilio · pnpm + Turborepo · GitHub Actions · Sentry · Pino + Prometheus + OTel

**Explicitly NOT used:** Kubernetes, Kafka, microservices, GraphQL, MongoDB, Meilisearch, Redux.

## Architecture mandates

- **Multi-tenancy:** TenantGuard + Prisma middleware + Postgres RLS + audit log.
- **Events:** Outbox pattern → Redis Streams. Idempotent consumers.
- **Validation:** Zod schemas in `packages/shared` shared between BE+FE.
- **Errors:** Global NestJS exception filter. Response shape: `{ code, message, details, traceId, timestamp }`.
- **API:** REST under `/api/v1`. OpenAPI auto-gen. Cursor pagination. `?filter[field]=…&sort=-createdAt`.
- **Uploads:** FE → presigned PUT → MinIO. API only stores metadata. Downloads via presigned GET (15min).
- **Polymorphic subjects:** Notes/Reminders/Attachments/Activities use `(subjectType, subjectId)` over Company/Contact/Client/Deal.

## Workflow per feature (strict loop)

1. Read this file + related code.
2. Propose plan (≤15 lines): files, schema changes, tests, verification.
3. **STOP**, wait for approval.
4. Implement: schema → migration → service → controller → tests.
5. `pnpm lint && pnpm test`.
6. Verify e2e (curl/browser). Paste evidence.
7. Update `docs/` if public API changed.
8. Conventional commit.
9. Report: what changed, how to test, what's next.
10. **Update [LESSONS.md](./LESSONS.md)** if anything broke or surprised you.

## Communication

- User prefers **Romanian** for explanations, **English** for code/comments.
- User values **honesty over agreement.** Push back if something is wrong.
- Keep things **simple**. No premature optimization. No speculative abstractions.
- **Ask** when in doubt.

## Roadmap (20 sprints × 1 week)

S0 skeleton · S1 NestJS+Prisma+Auth · S2 multi-tenant+RBAC+audit+RLS · S3 Companies/Contacts/Clients ·
S4 GestCom importer · S5 Notes+timeline · S6 Attachments+MinIO · S7 Reminders+BullMQ · S8 FE skeleton ·
S9 FE detail page · S10 Pipelines/Deals/Tasks · S11 Email · S12 Calls (Twilio) · S13 AI worker ·
S14 AI features · S15 Workflows/sequences · S16 Reports · S17 GDPR · S18 Backup+observability ·
S19 Railway deploy · S20 Polish + launch

## Before every session

1. Read this file.
2. Read [LESSONS.md](./LESSONS.md) — past mistakes you should not repeat.
3. Check current sprint status in commits / PRs.
