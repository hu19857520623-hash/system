# ERP Backend · NestJS + Prisma · 多阶段 / 缓存挂载 / 非 root
#
# build context: ./erp
#   docker build -f backend/Dockerfile -t erp-backend .

ARG DOCKER_REGISTRY=docker.io/library/
ARG NODE_VERSION=22-alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

# ── 1) 依赖（与源码分离，最大化缓存命中）──
FROM ${DOCKER_REGISTRY}node:${NODE_VERSION} AS deps
ARG NPM_REGISTRY
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat \
    && npm config set registry ${NPM_REGISTRY}
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund

# ── 2) 构建（含 seed 用的 builder-dev target）──
FROM deps AS builder-dev
COPY backend/prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npx prisma generate
COPY backend/ ./
COPY shared/ /shared/

FROM builder-dev AS builder
ENV NODE_ENV=production
RUN npm run build \
    && npm prune --omit=dev \
    && npm install prisma@5.20.0 --no-save --ignore-scripts --no-audit --no-fund

# ── 3) 运行（仅生产产物 + 非 root + dumb-init）──
FROM ${DOCKER_REGISTRY}node:${NODE_VERSION} AS runner
RUN apk add --no-cache openssl dumb-init \
    && addgroup -g 1001 -S erp \
    && adduser -S erp -u 1001 -G erp
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    LISTEN_HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=builder --chown=erp:erp /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=erp:erp /app/node_modules ./node_modules
COPY --from=builder --chown=erp:erp /app/dist ./dist
COPY --from=builder --chown=erp:erp /app/prisma ./prisma
COPY --from=builder --chown=erp:erp /app/scripts ./scripts
COPY --from=builder --chown=erp:erp /app/data ./data
COPY --chown=erp:erp backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 docker-entrypoint.sh \
    && mkdir -p /app/uploads/wcs-photos \
    && chown -R erp:erp /app/uploads

USER erp
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
# start:prod = verify:schema + node dist/main.js；postbuild 把 dist/main.js 指到 Nest 实际入口（dist/app/src/main.js 或 dist/backend/src/main.js）
CMD ["npm", "run", "start:prod"]
