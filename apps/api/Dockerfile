# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestJS API.
#
# IMPORTANT: build context MUST be the repo root (not apps/api).
# The pnpm workspace has to be present for `@amass/shared` to resolve.
#
# Local:         docker build -f apps/api/Dockerfile -t amass-api .
# Railway UI:    Root Directory = "/"  +  Dockerfile Path = "apps/api/Dockerfile"
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---- deps: install with the full workspace so `@amass/shared` links ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @amass/api... --filter @amass/shared

# ---- build ----
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @amass/shared build || true
RUN pnpm --filter @amass/api exec prisma generate
RUN pnpm --filter @amass/api build

# ---- runtime: prod-only deps, smaller image ----
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @amass/api... --filter @amass/shared
# Prisma Client enums (UserRole, etc.) are generated code — they live inside
# node_modules/@prisma/client AFTER `prisma generate` runs against the schema.
# Without this, dist/modules/*/.controller.js explodes at require-time with
#   TypeError: Cannot read properties of undefined (reading 'OWNER')
# because the fresh `--prod` install brings a stub client with no enums.
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && pnpm exec prisma generate

FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build    /repo/packages/shared ./packages/shared
COPY --from=build    /repo/apps/api/dist ./apps/api/dist
COPY --from=build    /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build    /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
# Railway injects PORT. Nest reads PORT from env via loadEnv().
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/main.js"]
