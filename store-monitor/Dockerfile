# syntax=docker/dockerfile:1

ARG DOCKER_REGISTRY=docker.io/library/

FROM ${DOCKER_REGISTRY}node:22-alpine AS runner
RUN apk add --no-cache curl \
    && addgroup -g 1001 -S monitor \
    && adduser -S monitor -u 1001 -G monitor
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3456 \
    LISTEN_HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

COPY server ./server
COPY web ./web
RUN chown -R monitor:monitor /app

USER monitor
EXPOSE 3456
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3456/health >/dev/null 2>&1 || wget -qO- http://127.0.0.1:3456/ >/dev/null || exit 1
CMD ["node", "server/index.js"]
