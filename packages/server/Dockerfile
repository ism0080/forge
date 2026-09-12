FROM node:26-alpine AS base

WORKDIR /app
RUN npm install -g --ignore-scripts=false --no-fund --no-audit @nubjs/nub@0.9.0

# Every workspace manifest must be present for the frozen-lockfile install to
# validate; only the server's dependency graph is actually linked (and, for
# prod-deps, only its production graph).
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/tools/oxlint/package.json packages/tools/oxlint/package.json
COPY packages/vite-plugin/package.json packages/vite-plugin/package.json

RUN nub install --frozen-lockfile --filter @ism0080/forge-server... --include-workspace-root

FROM deps AS build

# Root tsconfigs are copied after install so the install does not try to
# resolve their `extends` targets before the dependencies exist.
COPY tsconfig.base.json tsconfig.json ./
COPY packages/core packages/core
COPY packages/server packages/server

RUN nub run --filter @ism0080/forge-core build
RUN nub run --filter @ism0080/forge-server build

# Runtime only needs the emitted JS. Type declarations, declaration/source maps
# and incremental build info are compile-time artifacts we can drop.
RUN find packages/core/dist packages/server/dist -type f \
      \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' -o -name '*.tsbuildinfo' \) \
      -delete

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/tools/oxlint/package.json packages/tools/oxlint/package.json
COPY packages/vite-plugin/package.json packages/vite-plugin/package.json

# nub 0.9.0 links node_modules into a per-user virtual store via absolute
# symlinks. Build that store under the node user's home so the runtime (which
# drops to `node`) can still resolve it.
ENV HOME=/home/node
ENV XDG_CACHE_HOME=/home/node/.cache

RUN nub install --prod --frozen-lockfile --ignore-scripts --filter @ism0080/forge-server...

FROM node:26-alpine AS runtime

# Never ship dev-time behaviour or pretty error stacks in production.
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prod-deps /app/packages/core/package.json ./packages/core/package.json
COPY --from=prod-deps /app/packages/server/package.json ./packages/server/package.json

COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules

# nub links node_modules into a per-user virtual store using absolute paths;
# the runtime must carry that store at the same path for the links to resolve.
COPY --from=prod-deps /home/node/.cache/nub/pm/store /home/node/.cache/nub/pm/store

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist

# Environment schema resolved by `varlock/auto-load` at boot (loadPath "../../")
COPY .env.schema ./.env.schema

# `varlock/auto-load` shells out to the CLI, so keep its package-local bin on PATH
ENV PATH="/app/packages/server/node_modules/.bin:${PATH}"

# Writable root for STORAGE_ROOT/DATABASE_ROOT (./data). Creating it here with
# the right ownership lets a fresh named volume inherit it from the image.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
ENV HOME=/home/node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "packages/server/dist/main.js"]
