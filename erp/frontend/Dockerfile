# ERP Frontend · Vue/Vite → nginx:alpine
#
# build context: ./erp
#   docker build -f frontend/Dockerfile -t erp-frontend .
#
# 国内镜像示例：
#   DOCKER_REGISTRY=docker.m.daocloud.io/library/

ARG DOCKER_REGISTRY=docker.io/library/
ARG NODE_VERSION=22-alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${DOCKER_REGISTRY}node:${NODE_VERSION} AS builder
ARG NPM_REGISTRY
WORKDIR /app
RUN npm config set registry ${NPM_REGISTRY}
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
COPY shared/ /shared/
ENV NODE_ENV=production
RUN npm run build

FROM ${DOCKER_REGISTRY}nginx:alpine AS runner
RUN apk add --no-cache wget \
    && rm -f /etc/nginx/conf.d/default.conf
COPY frontend/nginx.docker.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
