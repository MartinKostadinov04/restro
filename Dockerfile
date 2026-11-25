# Container images of Restro's three services, one target each, built from the repository root:
#
#   docker build --target web     ...   the web app (Next.js), port 3000, GET /api/health
#   docker build --target worker  ...   the worker, port 8081 (WORKER_HEALTH_PORT), GET /health
#   docker build --target sim-pos ...   the simulated POS, port 4010, GET /healthz
#
# docker-compose.staging.yml builds them for staging; nothing here names a host or a platform, so
# production may build and run the same targets anywhere. Health checks belong to whoever runs
# the images (the Compose file), so there is no HEALTHCHECK here. No migration runs in any image.
#
# Stages: `base` (Node + pnpm) -> `fetched` (the lockfile's packages) -> `source` (the repository)
# -> `deps` (every dependency, for building) and `prod-deps` (runtime dependencies only). The
# runtime targets start from `runtime`, which has Node but no pnpm: each starts `node` directly.

ARG NODE_IMAGE=node:24.21.0-bookworm-slim

# --- Node and pnpm, for building only ------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
# pnpm at the version package.json's packageManager names, through Node's own corepack (checked
# against package.json in the next stage, so the two cannot drift apart silently).
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app

# --- The lockfile's packages, in pnpm's store (cached until the lockfile changes) ---------------
FROM base AS fetched
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# .npmrc pins `use-node-version`, which makes pnpm download its own Node for every script it runs.
# This image's Node is already that exact version (checked here, so the two cannot drift apart
# silently), so the build drops the line instead of downloading a second copy of the same Node.
# engine-strict stays and still checks engines.node. pnpm's version is checked against
# package.json's packageManager the same way.
RUN expected="v$(sed -n 's/^use-node-version=//p' .npmrc)" \
 && [ "$(node --version)" = "$expected" ] \
    || { echo "The image's Node $(node --version) is not .npmrc's $expected: update NODE_IMAGE." >&2; exit 1; } \
 && sed -i '/^use-node-version=/d' .npmrc \
 && manager="pnpm@$(pnpm --version)" \
 && grep -q "\"packageManager\": \"$manager\"" package.json \
    || { echo "The image's $manager is not package.json's packageManager: update the base stage." >&2; exit 1; } \
 && pnpm fetch

# --- The repository ---------------------------------------------------------------------------
FROM fetched AS source
COPY . .
# The same .npmrc line as above (COPY brought it back); the version check already ran.
RUN sed -i '/^use-node-version=/d' .npmrc

# --- Every dependency, for the builds --------------------------------------------------------
FROM source AS deps
RUN pnpm install --frozen-lockfile --offline

# --- Runtime dependencies only: what the images ship ---------------------------------------
# Every package's `dependencies`, with the platform's native binaries (sharp's libvips for this
# Linux), and none of the dev tools. `pnpm fetch` left a modules folder made for every dependency;
# a production-only install replaces it, which pnpm otherwise refuses to do without a terminal.
FROM source AS prod-deps
RUN pnpm install --frozen-lockfile --offline --prod --config.confirm-modules-purge=false

# --- The worker's bundle -----------------------------------------------------------------------
FROM deps AS worker-build
RUN pnpm --filter @restro/worker build

# --- The web app's build ---------------------------------------------------------------------
FROM deps AS web-build
# Public values `next build` inlines into the bundle: build arguments of this target only.
# PAYMENTS_ENV says whether the build is for production (real money), which decides the mode of
# the publishable key the check below accepts.
ARG NEXT_PUBLIC_CDN_BASE_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG PAYMENTS_ENV
# Stops the build, naming the variable, when a public value is missing or in the wrong mode.
RUN node --disable-warning=ExperimentalWarning apps/web/scripts/check-build-env.ts \
 && pnpm --filter @restro/web build \
 && rm -rf apps/web/.next/cache

# --- What every runtime image starts from: Node, no pnpm ---------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NEXT_TELEMETRY_DISABLED=1
COPY docker/start.sh /usr/local/bin/restro-start
# The shared data folder (photos under /data/assets, published menus under /data/cdn). A named
# volume mounted here starts as a copy of this folder, so it belongs to the `node` user.
RUN mkdir -p /data/assets /data/cdn && chown -R node:node /data
WORKDIR /app
ENTRYPOINT ["/bin/sh", "/usr/local/bin/restro-start"]

# --- Target: the worker ----------------------------------------------------------------------
FROM runtime AS worker
# No NODE_ENV here: NODE_ENV=production makes the worker refuse every simulated POS, which staging
# runs. The deployment's environment label (BARSY_ENV) says staging or production instead, and
# switches the logs to JSON (apps/worker/src/config.ts).
COPY --from=prod-deps /app /app
COPY --from=worker-build /app/apps/worker/dist /app/apps/worker/dist
# The bundle reads the simulated POS's scenario files from `../scenarios/` next to `dist/`, where
# the package's own source reads them from beside its `src/`.
COPY --from=prod-deps /app/packages/connectors/sim-pos/scenarios /app/apps/worker/scenarios
WORKDIR /app/apps/worker
USER node
EXPOSE 8081
CMD ["node", "dist/index.js"]

# --- Target: the web app -----------------------------------------------------------------------
FROM runtime AS web
# The public values the bundle was built with, also in the environment: server code that reads
# them at run time (the table links' CDN address) then agrees with the bundle.
ARG NEXT_PUBLIC_CDN_BASE_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NODE_ENV=production \
    NEXT_PUBLIC_CDN_BASE_URL=${NEXT_PUBLIC_CDN_BASE_URL} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
# The whole workspace: next.config.ts and the files it imports are read again at start.
COPY --from=prod-deps /app /app
# Next writes its cache under .next at run time, so the build output belongs to `node`.
COPY --from=web-build --chown=node:node /app/apps/web/.next /app/apps/web/.next
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Target: the simulated POS -----------------------------------------------------------------
FROM runtime AS sim-pos
# Runs the package's TypeScript source, as `pnpm sim:serve` does. It listens beyond this machine
# only with SIM_POS_CONTROL_TOKEN set (packages/connectors/sim-pos/src/control/server.ts).
COPY --from=prod-deps /app /app
USER node
EXPOSE 4010
CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-transform-types", "--import", "./apps/web/scripts/register-ts.mjs", "packages/connectors/sim-pos/src/cli.ts", "serve", "--host", "0.0.0.0", "--port", "4010"]
