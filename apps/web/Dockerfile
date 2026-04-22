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
FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

# nginx TEMPLATE — the official image runs `envsubst` over files in
# /etc/nginx/templates/ at start, writing the result to /etc/nginx/conf.d/,
# which lets us honour $PORT from Railway and fall back to 80 for compose.
RUN printf 'server {\n  listen       ${PORT};\n  server_name  _;\n  root         /usr/share/nginx/html;\n  index        index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/templates/default.conf.template \
 && rm -f /etc/nginx/conf.d/default.conf

ENV PORT=80
EXPOSE 80
