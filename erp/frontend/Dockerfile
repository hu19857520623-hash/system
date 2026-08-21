# ERP Frontend · Vue/Vite → nginx-unprivileged
#
# build context: ./erp
#   docker build -f frontend/Dockerfile -t erp-frontend .
#
# 国内拉 nginxinc 镜像时可设：
#   DOCKER_REGISTRY=docker.m.daocloud.io/

ARG DOCKER_REGISTRY=docker.io/library/
ARG NODE_VERSION=22-alpine
ARG NGINX_BASE=docker.io/
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

FROM ${NGINX_BASE}nginxinc/nginx-unprivileged:1.27-alpine AS runner
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY frontend/nginx.docker.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
