# Forge

Forge is a local-first toolkit for building small, mobile-friendly web apps and PWAs. It keeps everything on your machine: a local dev server, filesystem storage, and a CLI that scaffolds projects from templates.

- `packages/server`: Effect-based local API with filesystem storage and a simple document database
- `packages/cli`: `forge` CLI (`init`, `deploy`, `plugins list`, `dev`) with project templates
- `packages/templates`: starter templates used by `forge init`
- `packages/core`: shared types and configuration contracts
- `packages/sdk`: reusable SDK (`createClient`) for DB, uploads, and webhooks
- `packages/vite-plugin`: Vite plugin that injects `forge.json` values through `virtual:forge`
- `docker-compose.yml`: local stack with API, persistent local storage, and NGINX

## Requirements

- Node.js 22+
- pnpm 10+
- Docker + Docker Compose

## Install

```bash
pnpm install
```

## Run local stack

```bash
docker compose up --build
```

If dependencies changed, rebuild the API image:

```bash
docker compose build --no-cache api
docker compose up --force-recreate
```

Services:

- API: `http://localhost:8787`
- NGINX: `http://localhost:8880`

## Environment

Environment variables are declared in `.env.schema` and validated with
[varlock](https://varlock.dev). The schema is committed and is the single source
of truth; put non-secret defaults there and local values in `.env.local`
(git-ignored). Process environment variables always take precedence.

```bash
pnpm env:check   # validate the schema and show resolved values
pnpm dev:api     # runs the API through `varlock run`
```

The server imports `varlock/auto-load`, so `pnpm dev:api` and the Docker image
validate and inject env at boot. Docker Compose declares no env inline; it layers
in `.env.local` when present, so the schema stays the single source of truth. The
webhook gateway is disabled unless `EXTERNAL_API_URL` (and usually
`EXTERNAL_API_KEY`) are set.

## Templates

`forge init` scaffolds a new project from a template in `packages/templates`:

```bash
forge init my-app
forge init --template pwa my-app
```

Available templates:

- `default`: minimal Vite + TypeScript site with oxlint, oxfmt, and Forge SDK
- `pwa`: React PWA starter with Vite, Tailwind CSS v4, [TanStack Query](https://tanstack.com/query), [TanStack Router](https://tanstack.com/router), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/), and [shadcn/ui](https://ui.shadcn.com)

Lint/format config (`oxlint.config.ts`, `.gitignore`) is shared from `packages/templates/src/shared`, while `tsconfig.json` and `package.json` are template-specific. Generated apps extend `@total-typescript/tsconfig/bundler/dom/app`.

## Build and run CLI

```bash
pnpm --filter @ism0080/forge-cli build
node packages/cli/dist/index.js init demo
node packages/cli/dist/index.js init --template pwa demo
node packages/cli/dist/index.js deploy
node packages/cli/dist/index.js deploy ./dist demo
node packages/cli/dist/index.js plugins list
node packages/cli/dist/index.js dev
```

`deploy` supports optional positional arguments:

- `deploy <folder> <site-id>` deploys without requiring `forge.json`
- `deploy` (without args) continues to read `forge.json`

## DB API

The server stores documents in a per-site SQLite database (`node:sqlite`, WAL mode):

- Service interface: `packages/server/src/services/db/service.ts`
- SQLite adapter: `packages/server/src/services/db/sqlite.ts`
- Per-site connections: `packages/server/src/services/db/sqlite-connection.ts`

Current endpoints:

- `GET /api/db/:collection?siteId=<siteId>&limit=<n>&cursor=<cursor>&whereField=<field>&whereValue=<value>&search=<text>&sortBy=<createdAt|updatedAt|id>&sortDir=<asc|desc>`
- `GET /api/db/:collection/:id?siteId=<siteId>`
- `POST /api/db/:collection` with `{ "siteId": "...", "data": { ... }, "id": "optional" }`
- `PUT /api/db/:collection/:id` with `{ "siteId": "...", "data": { ... }, "expectedVersion": 1 }` (optional optimistic concurrency)
- `DELETE /api/db/:collection/:id?siteId=<siteId>&expectedVersion=<n>` (optional optimistic concurrency)
- `GET /api/db/events?siteId=<siteId>&collection=<collection>` websocket stream of DB events
- `POST /api/db/migrations` applies an ordered bundle of Drizzle-generated SQL migrations
- `GET|POST|PUT|DELETE /api/tables/:table[/:id]` provides generic row CRUD for Drizzle tables

Notes:

- Documents include `version` (starting at `1` and incrementing on each update).
- If `expectedVersion` does not match, the API returns `409 version conflict`.
- `search` runs an FTS5 full-text query over the document JSON for the collection.
- The DB adapter emits create/update/delete change events through a pluggable events service (`packages/server/src/db/events.ts`).
- Current default wiring uses an in-memory pub/sub bus (`DbEventsInMemoryLayer`) plus a console tap (`DbEventsConsoleTapLayer`), ready for websocket fanout wiring.
- Migration history stores server-computed SHA-256 hashes, timestamps, durations, and deployment IDs. Limits are configured with `DB_MIGRATION_MAX_COUNT`, `DB_MIGRATION_MAX_BYTES`, `DB_MIGRATION_MAX_BUNDLE_BYTES`, and `DB_MIGRATION_TIMEOUT_MS`.

## SDK usage

```ts
import { createClient } from "@ism0080/forge-sdk";

const client = createClient({
  baseUrl: "http://localhost:8787",
  siteId: "demo",
});

const posts = client.db.collection("posts");
await posts.create({ data: { title: "Hello", status: "draft" } });
const page1 = await posts.list({
  limit: 20,
  whereField: "status",
  whereValue: "draft",
  sortBy: "createdAt",
  sortDir: "desc",
});
const matches = await posts.list({ search: "hello world" });
const first = page1.documents[0];
if (first) {
  await posts.update(first.id, {
    data: { ...first.data, status: "published" },
    expectedVersion: first.version,
  });
  await posts.get(first.id);
  await posts.delete(first.id, { expectedVersion: first.version + 1 });
}

const unsubscribe = posts.subscribe({
  onCreate: (doc) => console.log("New:", doc),
  onUpdate: (doc) => console.log("Updated:", doc),
  onDelete: (id) => console.log("Deleted:", id),
});

// Later:
unsubscribe();
```

`createClient` is synchronous. Failed requests reject with a `ForgeApiError` whose `code` is the
server error (for example `"document not found"` or `"version conflict"`):

```ts
import { ForgeApiError } from "@ism0080/forge-sdk";

try {
  await posts.get("missing");
} catch (error) {
  if (error instanceof ForgeApiError && error.code === "document not found") {
    // handle not found
  }
}
```

## Webhook gateway

The server can forward webhook calls to an external API configured with `EXTERNAL_API_URL` and `EXTERNAL_API_KEY`:

- `POST /api/webhook` with `{ "title": "...", "message": "...", "payload": optional }`

SDK usage:

```ts
const result = await client.webhook({
  title: "New post",
  message: "A post was published",
  payload: { postId: "123" },
});
```

## Scheduled jobs

Per-site cron jobs are stored in SQLite and executed by a background runner. Each
occurrence is forwarded through the webhook gateway (so it uses the same
`EXTERNAL_API_URL` / `EXTERNAL_API_KEY` configuration). Schedules are 5-field cron
expressions (`minute hour day month weekday`) evaluated in UTC.

Endpoints:

- `GET /api/jobs?siteId=<siteId>`
- `GET /api/jobs/:id?siteId=<siteId>`
- `POST /api/jobs` with `{ "siteId": "...", "name": "...", "schedule": "0 3 * * *", "payload": optional, "enabled": optional }`
- `PUT /api/jobs/:id` with `{ "siteId": "...", "schedule": "...", "enabled": false, "expectedVersion": 1 }`
- `DELETE /api/jobs/:id?siteId=<siteId>&expectedVersion=<n>`
- `POST /api/jobs/:id/run?siteId=<siteId>` runs a job immediately

SDK usage:

```ts
const job = await client.jobs.create({
  name: "nightly-cleanup",
  schedule: "0 3 * * *",
  payload: { kind: "cleanup" },
});

await client.jobs.list();
await client.jobs.update(job.id, { enabled: false, expectedVersion: job.version });
await client.jobs.run(job.id);
await client.jobs.delete(job.id, job.version + 1);
```

CLI:

```bash
forge jobs list
forge jobs run <job-id>
```

The runner is controlled by `JOB_RUNNER_ENABLED` (default `true`) and
`JOB_RUNNER_INTERVAL_MS` (default `30000`).

## Health

- `GET /health` returns `{ healthy: true }`.

## Multiple sites via subdomain

Deploy different folders with different `siteId` values (for example `demo` and `docs`).

Then add local host mappings:

```text
127.0.0.1 demo.localhost
127.0.0.1 docs.localhost
```

And open:

- `http://demo.localhost:8880`
- `http://docs.localhost:8880`

## Multiple sites via path (no hosts file)

You can also access sites by path on localhost:

- `http://localhost:8880/s/demo/`
- `http://localhost:8880/s/docs/`

Any asset path works too, for example:

- `http://localhost:8880/s/demo/index.html`

## Site directory

`/directory` serves a simple directory page listing deployed sites:

- `http://localhost:8880/directory`

NGINX also maps the root path to the directory:

- `http://localhost:8880/`

By default, the CLI targets the `apiBaseUrl` from its built-in config (your Forge API).
Override per project with `FORGE_API_BASE_URL` or by editing `forge.json`.

## Vite plugin

`@ism0080/forge-vite-plugin` reads `forge.json` and exposes its values through the `virtual:forge` module.

```ts
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default {
  plugins: [forgePlugin()],
};
```

```ts
import { apiBaseUrl, baseUrl, siteId, basePath, spa, entry } from "virtual:forge";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
```

Sites are served under a subpath (`/s/<siteId>/`), so the plugin sets Vite's `base`
to `/s/<siteId>/` and exposes it as `basePath`. Point client-side routers at the same base:

```ts
const router = createRouter({ routeTree, basepath: basePath.replace(/\/+$/, "") });
```

Options:

```ts
forgePlugin({
  configPath: "./forge.json", // default
  base: "/s/demo/", // optional override; defaults to /s/<siteId>/
});
```

## Local registry

The packages publish to `http://localhost:4873`:

```bash
pnpm --filter @ism0080/forge-sdk publish:local
pnpm --filter @ism0080/forge-vite-plugin publish:local
pnpm --filter @ism0080/forge-cli publish:local
```

Install in a consumer project:

```bash
pnpm add @ism0080/forge-sdk --registry http://localhost:4873
pnpm add -D @ism0080/forge-vite-plugin --registry http://localhost:4873
```

Or set the registry once in the consumer `.npmrc`:

```ini
@ism0080:registry=http://localhost:4873
```

## Versioning and release

All published `@ism0080/*` packages share a single version and are released
together. `pnpm test` enforces alignment, and once a release is tagged (`vX.Y.Z`)
it also fails if `packages/**` changed without a matching version bump, so no
package can drift ahead of the others.

```bash
pnpm version:check   # enforce alignment and bump-on-change (also runs before tests)
pnpm version:all     # bump every package (patch; also: minor, major, or an explicit x.y.z)
pnpm publish:all     # bump, publish to the local registry, then tag vX.Y.Z
```

Tags use the `vX.Y.Z` form and are the baseline for the change check. Tag the
current release once to adopt the workflow: `node scripts/versions.mjs tag`.

## Forge config

Generated `forge.json` (default template):

```json
{
  "siteId": "demo",
  "entry": "dist",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true
}
```

The PWA template also sets `"database": { "migrations": "drizzle" }` so `forge deploy`
applies pending migrations before uploading assets.

When `spa` is `true`, non-asset route misses fall back to `index.html` for client-side routing.

## Notes

- `POST /api/upload` takes the raw file body (`application/octet-stream`) with
  `siteId`, `path`, and optional `contentType` as query parameters, so the server
  never buffers a base64 copy; the request body is capped at `UPLOAD_MAX_BYTES`
  (default 10 MB) at the HTTP layer so oversized uploads are rejected before
  they are buffered. The SDK's `client.upload({ path,
  contentBase64 })` decodes the base64 locally and sends raw bytes.
- Uploaded assets are stored on the local filesystem under the configured storage root (`STORAGE_ROOT`, default `./data`).
- Per-site SQLite connections are reference-counted and closed after
  `SITE_DB_IDLE_TTL_MS` (default 5 minutes) idle.
- The NGINX config maps root requests to `index.html` for host-based sites.
- This is intentionally small and meant to be extended with richer plugin APIs.
