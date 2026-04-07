# Multi-stage build for NestJS API
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json ./
RUN pnpm install --prod=false

# ---- build ----
FROM deps AS build
COPY . .
# Prisma generate is no-op until schema has models, but safe to run.
RUN pnpm exec prisma generate || true
RUN pnpm run build || echo "build skipped (no source yet)"

# ---- runtime ----
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
EXPOSE 3000
# Sprint 0: placeholder entrypoint until main.ts exists.
CMD ["node", "-e", "require('http').createServer((_,r)=>r.end('amass-api: sprint 0 placeholder')).listen(3000,()=>console.log('api on :3000'))"]
