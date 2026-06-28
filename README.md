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

## Templates

`forge init` scaffolds a new project from a template in `packages/templates`:

```bash
forge init my-app
forge init --template pwa my-app
```

Available templates:

- `default`: minimal Vite + TypeScript site with oxlint, oxfmt, and Forge SDK
- `pwa`: React PWA starter with Vite, Tailwind CSS v4, [TanStack Query](https://tanstack.com/query), [TanStack Router](https://tanstack.com/router), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/), and [coss ui](https://coss.com/ui)

Lint/format config (`.oxlintrc.json`, `.gitignore`) is shared from `packages/templates/src/shared`, while `tsconfig.json` and `package.json` are template-specific. Generated apps extend `@total-typescript/tsconfig/bundler/dom/app`.

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

The server includes a pluggable database service layer (similar to storage):

- Interface: `packages/server/src/db/service.ts`
- Local adapter: `packages/server/src/db/local-file.ts`

Current endpoints:

- `GET /api/db/:collection?siteId=<siteId>&limit=<n>&cursor=<cursor>&whereField=<field>&whereValue=<value>&sortBy=<createdAt|updatedAt|id>&sortDir=<asc|desc>`
- `GET /api/db/:collection/:id?siteId=<siteId>`
- `POST /api/db/:collection` with `{ "siteId": "...", "data": { ... }, "id": "optional" }`
- `PUT /api/db/:collection/:id` with `{ "siteId": "...", "data": { ... }, "expectedVersion": 1 }` (optional optimistic concurrency)
- `DELETE /api/db/:collection/:id?siteId=<siteId>&expectedVersion=<n>` (optional optimistic concurrency)
- `GET /api/db/events?siteId=<siteId>&collection=<collection>` websocket stream of DB events

Notes:

- Documents include `version` (starting at `1` and incrementing on each update).
- If `expectedVersion` does not match, the API returns `409 version conflict`.
- The DB adapter emits create/update/delete change events through a pluggable events service (`packages/server/src/db/events.ts`).
- Current default wiring uses an in-memory pub/sub bus (`DbEventsInMemoryLayer`) plus a console tap (`DbEventsConsoleTapLayer`), ready for websocket fanout wiring.

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

## Health

- `GET /health` returns `{ ok: true }`.

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

By default, the CLI targets `http://localhost:8787`.
Override with `FORGE_API_BASE_URL`.

## Vite plugin

`@ism0080/forge-vite-plugin` reads `forge.json` and exposes its values through the `virtual:forge` module.

```ts
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default {
  plugins: [forgePlugin()],
};
```

```ts
import { apiBaseUrl, baseUrl, siteId, spa, entry } from "virtual:forge";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
```

Options:

```ts
forgePlugin({
  configPath: "./forge.json", // default
  base: "./",                 // default Vite base
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

## Forge config

Generated `forge.json`:

```json
{
  "siteId": "demo",
  "entry": ".",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true
}
```

When `spa` is `true`, non-asset route misses fall back to `index.html` for client-side routing.

## Notes

- The upload API accepts base64 payloads for simplicity.
- Uploaded assets are stored on the local filesystem under the configured storage root (`STORAGE_ROOT`, default `./data`).
- The NGINX config maps root requests to `index.html` for host-based sites.
- This is intentionally small and meant to be extended with richer plugin APIs.
