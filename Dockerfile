FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN npx vite build

ENV NODE_ENV=production \
    CONTENT_DIR=/content \
    SITE_DIR=/site \
    PORT=4321

EXPOSE 4321

CMD ["node", "--import", "tsx", "src/server/index.ts"]
