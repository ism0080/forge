FROM node:25-alpine AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
RUN corepack enable && pnpm install

FROM deps AS build
COPY packages/core packages/core
COPY packages/server packages/server
RUN pnpm --filter @forge/core build && pnpm --filter @forge/server build

FROM node:25-alpine AS runtime
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
RUN corepack enable && pnpm install --prod
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
EXPOSE 8787
CMD ["node", "packages/server/dist/main.js"]
