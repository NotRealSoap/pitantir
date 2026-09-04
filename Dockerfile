# Pitantir — web + worker image (monorepo).
# Build: docker compose -f docker-compose.prod.yml build
FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Re-link after full source copy (workspace package.json / lockfile).
RUN pnpm install --frozen-lockfile
# Small VPS builds need headroom; raise if OOM.
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN pnpm --filter @pitantir/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app /app
COPY deploy/docker-entrypoint.sh /usr/local/bin/pitantir-entrypoint
RUN chmod +x /usr/local/bin/pitantir-entrypoint

EXPOSE 3000
ENTRYPOINT ["pitantir-entrypoint"]
CMD ["pnpm", "--filter", "@pitantir/web", "start"]
