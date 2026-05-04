# syntax=docker/dockerfile:1
# Docker build context MUST be repo root — see docker-compose `api.build.context`.

FROM node:22-alpine AS builder
WORKDIR /app

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/tsconfig.json ./
COPY app/src ./src
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY loadtests ./loadtests

COPY --from=grafana/k6:latest /usr/bin/k6 /usr/bin/k6

RUN mkdir -p /app/data/load-test-results \
  && chown -R node:node /app/data

ENV LOAD_TEST_RESULTS_DIR=/app/data/load-test-results

USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
