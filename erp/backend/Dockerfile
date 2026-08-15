# 国内网络可改用镜像源，docker compose 会传入 DOCKER_REGISTRY
ARG DOCKER_REGISTRY=docker.m.daocloud.io/library/

# ───── 构建阶段 ─────
FROM ${DOCKER_REGISTRY}node:20-bookworm-slim AS builder
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/backend
COPY backend/package*.json ./
RUN npm install --registry=https://registry.npmmirror.com
COPY backend/prisma ./prisma
RUN npx prisma generate
COPY backend/ ./
COPY shared/ ../shared/
RUN rm -rf dist *.tsbuildinfo && npm run build

# ───── 运行阶段 ─────
FROM ${DOCKER_REGISTRY}node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com \
    && npm install prisma --no-save --registry=https://registry.npmmirror.com
COPY --from=builder /workspace/backend/dist ./dist
COPY --from=builder /workspace/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /workspace/backend/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /workspace/backend/prisma ./prisma
COPY backend/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
