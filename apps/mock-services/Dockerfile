FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
EXPOSE 3001 3002 3003 3004 3005 3006 3007
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD curl -f http://localhost:3006/_health || exit 1
CMD ["node", "server.js"]
