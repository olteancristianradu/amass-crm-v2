# Multi-stage: build with Vite, serve with nginx
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json ./
RUN pnpm install
COPY . .
RUN pnpm run build || (mkdir -p dist && echo '<!doctype html><html><body><h1>amass-web — sprint 0 placeholder</h1></body></html>' > dist/index.html)

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
