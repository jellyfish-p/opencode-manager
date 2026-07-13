FROM oven/bun:1.3.14-debian AS builder

WORKDIR /app

COPY package.json bun.lock nuxt.config.ts tsconfig.json ./
RUN bun install --frozen-lockfile

COPY app ./app
COPY public ./public
COPY server ./server

RUN bun run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /app/.output ./.output
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
