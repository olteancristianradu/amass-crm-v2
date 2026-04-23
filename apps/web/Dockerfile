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
# The official nginx:alpine image runs `envsubst` over files in
# /etc/nginx/templates/ at container start, writing the result to
# /etc/nginx/conf.d/default.conf. We ship the template as a file (cleaner
# than a heredoc inside RUN, which broke under BuildKit escaping).
FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx-default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf

ENV PORT=80
EXPOSE 80
