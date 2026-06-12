# Forge (MVP scaffold)

This repository is a minimal Forge-like internal platform scaffold:

- `packages/server`: Effect-based API with plugin registry and local filesystem storage adapter
- `packages/cli`: `forge` CLI (`init`, `deploy`, `whoami`, `plugins list`, `dev`)
- `packages/core`: shared types and configuration contracts
- `packages/sdk`: reusable SDK (`createClient`) for DB interactions
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
- NGINX: `http://localhost:8080`

## Build and run CLI

```bash
pnpm --filter @forge/cli build
node packages/cli/dist/index.js init demo.localhost
node packages/cli/dist/index.js deploy
node packages/cli/dist/index.js deploy ./dist demo
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js plugins list
```

`deploy` now supports optional positional arguments:

- `deploy <folder> <site-id>` deploys without requiring `forge.json`
- `deploy` (without args) continues to read `forge.json`

## DB API (pluggable)

The server now includes a pluggable database service layer (similar to storage):

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

- Documents now include `version` (starting at `1` and incrementing on each update).
- If `expectedVersion` does not match, API returns `409 version conflict`.
- DB adapter emits create/update/delete change events through a pluggable events service (`packages/server/src/db/events.ts`).
- Current default wiring uses an in-memory pub/sub bus (`DbEventsInMemoryLayer`) plus a console tap (`DbEventsConsoleTapLayer`), ready for websocket fanout wiring.

## SDK usage

```ts
import { createClient } from "@forge/sdk";

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

## Multiple sites via subdomain

Deploy different folders with different `siteId` values (for example `demo` and `docs`).

Then add local host mappings:

```text
127.0.0.1 demo.localhost
127.0.0.1 docs.localhost
```

And open:

- `http://demo.localhost:8080`
- `http://docs.localhost:8080`

## Multiple sites via path (no hosts file)

You can also access sites by path on localhost:

- `http://localhost:8080/s/demo/`
- `http://localhost:8080/s/docs/`

Any asset path works too, for example:

- `http://localhost:8080/s/demo/index.html`

## Site directory at root

Nginx root now serves a simple directory page listing deployed sites:

- `http://localhost:8080/`

By default, the CLI targets `http://localhost:8787`.
Override with `FORGE_API_BASE_URL`.

## Forge config

Generated `forge.json`:

```json
{
  "siteId": "demo.localhost",
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
