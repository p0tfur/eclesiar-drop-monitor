<<<<<<< G:/_programowanie/_projekty/Eclesiar/skrypty/drop-monitor-backend/Dockerfile
# Multi-stage build for Drop Monitor Backend
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev && \
    npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && \
    npm prune --production

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

RUN mkdir -p /app/data && \
    chown -R nodejs:nodejs /app/data

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production \
    DROP_PORT=3000 \
    DROP_DB_PATH=/app/data/drop-monitor.db

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
=======
# Multi-stage build for Drop Monitor Backend
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev && \
    npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && \
    npm prune --production

FROM node:20-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache tini su-exec curl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

RUN mkdir -p /app/data && \
    chown -R nodejs:nodejs /app/data

EXPOSE 3000

ENV NODE_ENV=production \
    DROP_PORT=3000 \
    DROP_DB_PATH=/app/data/drop-monitor.db

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "DB_PATH=\"${DROP_DB_PATH:-/app/data/drop-monitor.db}\"; DB_DIR=\"$(dirname \"$DB_PATH\")\"; mkdir -p \"$DB_DIR\" && chown -R nodejs:nodejs \"$DB_DIR\" && exec su-exec nodejs node dist/server.js"]
>>>>>>> C:/Users/shogun/.windsurf/worktrees/drop-monitor-backend/drop-monitor-backend-78729ded/Dockerfile
