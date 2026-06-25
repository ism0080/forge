FROM node:25-alpine AS base

WORKDIR /app
RUN npm install -g --ignore-scripts=false @nubjs/nub

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json

RUN nub install --frozen-lockfile

FROM deps AS build

COPY packages/core packages/core
COPY packages/server packages/server

RUN nub --filter @ism0080/forge-core build
RUN nub --filter @ism0080/forge-server build

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json

RUN nub install --prod --filter @ism0080/forge-server... --frozen-lockfile

FROM node:25-alpine AS runtime

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prod-deps /app/packages/core/package.json ./packages/core/package.json
COPY --from=prod-deps /app/packages/server/package.json ./packages/server/package.json

COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist

EXPOSE 8787

CMD ["node", "packages/server/dist/main.js"]
