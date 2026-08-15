FROM docker.m.daocloud.io/library/node:20-bookworm-slim

RUN apt-get update -y && apt-get install -y curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com

COPY server ./server
COPY web ./web

ENV PORT=3456
EXPOSE 3456

CMD ["node", "server/index.js"]
