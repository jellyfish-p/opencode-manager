FROM oven/bun:1.3.14-debian AS bun

FROM node:22-bookworm AS builder

WORKDIR /app

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock nuxt.config.ts tsconfig.json ./
# Keep Bun's locked dependency graph, but build native modules with the same
# Node.js major version used by the production image.
RUN bun install --frozen-lockfile --ignore-scripts \
    && npm rebuild better-sqlite3

COPY app ./app
COPY public ./public
COPY server ./server

RUN npm run build

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
