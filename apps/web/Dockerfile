# Multi-stage build for the Vite/React SPA.
#
# Build context MUST be the repo root (pnpm workspace for `@amass/shared`).
# Railway UI:  Root Directory = "/"  +  Dockerfile Path = "apps/web/Dockerfile"
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @amass/web... --filter @amass/shared

# ---- build ----
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @amass/shared build || true
RUN pnpm --filter @amass/web build

# ---- runtime: nginx static, $PORT-aware (Railway injects PORT) ----
#
# nginxinc/nginx-unprivileged runs as UID 101 (non-root) and binds to
# $PORT (default 8080) — eliminates container-escape → root on host.
# The same template + envsubst behaviour from the official image applies.
FROM nginxinc/nginx-unprivileged:alpine AS runtime
USER root
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx-default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf && chown -R 101:101 /usr/share/nginx/html
USER 101

# Default to 8080 (non-privileged) so nginx can run as UID 101. Railway /
# compose map host->container port, so external 80 still works.
ENV PORT=8080
EXPOSE 8080
