# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestJS API.
#
# IMPORTANT: build context MUST be the repo root (not apps/api).
# The pnpm workspace has to be present for `@amass/shared` to resolve.
#
# Local:         docker build -f apps/api/Dockerfile -t amass-api .
# Railway UI:    Root Directory = "" (empty)  +  Config-as-Code Path = apps/api/railway.toml
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

# ---- runtime ----
# We intentionally reuse the `build` stage's node_modules (includes devDeps)
# instead of a --prod install:
#   1) `prisma` CLI is a devDependency, so --prod removes it and we can't
#      `prisma generate` in a standalone prod-deps stage.
#   2) the generated Prisma Client (UserRole enum etc.) lives inside
#      node_modules/.pnpm/@prisma+client@.../@prisma/client — a fresh --prod
#      install brings a stub without the enums, and the controllers crash:
#        TypeError: Cannot read properties of undefined (reading 'OWNER')
# Image is ~100MB larger — worth the correctness.
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
# Railway injects PORT. Nest reads PORT from env via loadEnv().
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/main.js"]
