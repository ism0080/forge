# Forge — Plan

## Goal

Forge is a local-first toolkit for hosting small web apps and PWAs on a private
Tailscale network. Each site is served under a path prefix (`/s/<siteId>/`), and
the server provides shared backend primitives — SQLite-backed document and table
storage with realtime events, file uploads, and webhook forwarding — so apps do
not reimplement them. Templates and oxlint rules encode how apps should be
structured, for both humans and agents.

The runtime is a single Effect-based HTTP API behind NGINX, plus a CLI and a
browser SDK. It is not a multi-tenant platform: Tailscale is the trust boundary.

## Principles

- Private by default: the private network is the access control; the server adds
  no auth layer.
- One small, fixed feature set; prefer reusing DB/webhook over adding surfaces.
- Effect-native and typed end to end; the HTTP contract lives in `forge-core`
  and is shared by the server and the SDK.
- Overwrite deploys: `forge deploy` uploads the build output for a site id.
- Templates and lint rules are the primary developer surface; keep them correct.
- All published packages version and release in lockstep.

## Architecture

- `packages/core` — shared Effect schemas/types plus the HttpApi contract
  (`@ism0080/forge-core/api`).
- `packages/server` — Effect `unstable/httpapi` app; per-site SQLite
  (`node:sqlite`, WAL); filesystem object storage; DB event bus; webhook gateway;
  OpenAPI at `/openapi.json`.
- `packages/sdk` — browser/client SDK; synchronous `createClient`; typed
  collection and Drizzle-table clients; realtime subscriptions; typed
  `ForgeApiError`.
- `packages/cli` — `forge init | deploy | db push | plugins list | dev`.
- `packages/templates` — `default` and `pwa` starters, including template-level
  `forge.json` defaults.
- `packages/vite-plugin` — exposes `forge.json` via `virtual:forge`; sets Vite
  `base` to `/s/<siteId>/` and exports `basePath`.
- `packages/tools/oxlint` — `@ism0080/oxlint-plugin-forge` profiles.
- `docker-compose.yml` + `nginx/` — API on `8787`, NGINX on `8880`; routes
  `/s/<siteId>/` and `/api/`.

## Implemented

Static hosting and routing:

- Per-site namespaces (`sites/<siteId>/...`) served under `/s/<siteId>/` via
  NGINX, with SPA fallback to `index.html` for non-asset routes.
- Site directory at `/directory`, with delete.
- `forge deploy` uploads a build folder and writes `spa` metadata so fallback
  works when deploying `dist`.

Database:

- Per-site SQLite document collections: CRUD, list/filter, keyset pagination,
  and optimistic concurrency via `expectedVersion`.
- Full-text search over collection documents via an FTS5 index kept in sync by
  triggers; `search=<text>` on the list endpoint.
- Drizzle-table row CRUD with typed SDK mapping; ordered migrations with hashes,
  ordering/immutability checks, and configurable limits.
- Realtime create/update/delete events over websocket for collections and tables.

Other:

- Scheduled jobs: per-site cron jobs stored in SQLite, executed by a background
  runner that forwards each occurrence through the webhook gateway. Exposed over
  HTTP and the SDK, with `forge jobs list` / `forge jobs run`.
- Base64 file upload to per-site object storage.
- Webhook forwarding to `EXTERNAL_API_URL` with retries and timeouts.
- Plugin registry (`/api/plugins`) — currently reports file capabilities.
- CLI `init`, `deploy`, `db push`, `jobs list`, `jobs run`, `plugins list`, `dev`.
- Templates `default` and `pwa` (React 19, TanStack Query/Router, Tailwind v4,
  shadcn/ui on Base UI, vite-plugin-pwa, Drizzle), with subpath-aware Vite base
  and router basepath and preconfigured `entry`/migrations.
- One shared contract: the SDK depends on `forge-core`, not the server package.
- CI workflow runs lint, typecheck, and tests; `pnpm-lock.yaml` is committed for
  reproducible installs.
- Lockstep package versioning enforced by `scripts/versions.mjs`, wired into
  `pnpm test`.

## Out of scope

The earlier "internal hosting platform" direction is dropped:

- No org SSO/auth gate, user identity, or `/api/whoami`; the private network is
  the boundary.
- No AI proxy, data warehouse/query API, billing, quotas, or abuse controls.
- No multi-tenant ownership model.

## Known gaps / next

Routing and hosting:

- Host-based subdomains in `nginx/default.conf` serve `index.html` for every
  path, so subdomain assets are broken. `/s/<siteId>/` is the supported route;
  either fix or remove subdomain routing.
- Static responses have no caching/ETag; uploads send no content type (the
  server infers it from the file extension).

API:

- No upload size/type limits; base64 bodies are buffered in memory.
- Websocket subscriptions rely on network trust, with only a fixed sliding queue
  for backpressure.

DX:

- SDK table clients support keyset pagination but no typed field filters
  (documents support `whereField`/`whereValue`).
- Jobs are cron expressions evaluated in UTC and only forward to the webhook
  gateway; there is no in-process handler API.

Ops:

- No backup/restore tooling beyond SQLite `VACUUM INTO` guidance, and no
  retention for stale databases or uploads.
- `node:sqlite` is experimental; Docker builds on `node:25` while `.nvmrc` pins
  v26.

## Success criteria

- `forge init` → build → `forge deploy` yields a working app at `/s/<siteId>/`
  with no manual configuration.
- Apps can persist data (collections or Drizzle tables), paginate, and subscribe
  to changes.
- Webhooks can be sent without exposing provider secrets in the client.
- Server and SDK stay typed against one shared contract, and packages never
  drift in version.
- The stack operates with low overhead on a private network.

## Versioning and release

- All published `@ism0080/*` packages share one version and are released
  together.
- `pnpm version:check` enforces alignment and bump-on-change (also runs as part
  of `pnpm test`).
- `pnpm version:all [patch|minor|major|x.y.z]` bumps every package;
  `pnpm publish:all` bumps, publishes to the local registry, and tags `vX.Y.Z`.
