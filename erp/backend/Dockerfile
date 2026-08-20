# syntax=docker/dockerfile:1

# 可选镜像前缀（国内可设 DOCKER_REGISTRY=docker.m.daocloud.io/library/）
ARG DOCKER_REGISTRY=docker.io/library/

# ── 依赖层（BuildKit 缓存 npm）──
FROM ${DOCKER_REGISTRY}node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# ── 构建层 ──
FROM deps AS builder-dev
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/ ./
COPY shared/ /shared/

FROM builder-dev AS builder
ENV NODE_ENV=production
RUN npm run build \
    && npm prune --omit=dev \
    && npm install prisma@5.20.0 --no-save --ignore-scripts

# ── 运行层（非 root + dumb-init）──
FROM ${DOCKER_REGISTRY}node:22-alpine AS runner
RUN apk add --no-cache openssl dumb-init \
    && addgroup -g 1001 -S erp \
    && adduser -S erp -u 1001 -G erp
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN_HOST=0.0.0.0

COPY --from=builder --chown=erp:erp /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=erp:erp /app/node_modules ./node_modules
COPY --from=builder --chown=erp:erp /app/dist ./dist
COPY --from=builder --chown=erp:erp /app/prisma ./prisma
COPY --chown=erp:erp backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 docker-entrypoint.sh

USER erp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
