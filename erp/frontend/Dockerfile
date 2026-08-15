# 国内网络可改用镜像源，docker compose 会传入 DOCKER_REGISTRY
ARG DOCKER_REGISTRY=docker.m.daocloud.io/library/
FROM ${DOCKER_REGISTRY}node:20-alpine AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

COPY frontend/ ./
COPY shared/ /shared/
RUN npm run build

FROM ${DOCKER_REGISTRY}nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
