FROM oven/bun:1.3.14-debian AS builder

WORKDIR /app

COPY package.json bun.lock nuxt.config.ts tsconfig.json ./
RUN BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1 \
    bun install --frozen-lockfile --ignore-scripts

COPY app ./app
COPY public ./public
COPY server ./server

RUN bun run build

FROM oven/bun:1.3.14-debian AS runner

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

COPY --from=builder --chown=bun:bun /app/.output ./.output
RUN mkdir -p /app/data && chown -R bun:bun /app/data
COPY --chown=root:root --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

VOLUME ["/app/data"]
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", ".output/server/index.mjs"]
