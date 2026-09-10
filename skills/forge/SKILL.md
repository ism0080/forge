---
name: forge
description: Helps develop, configure, and deploy sites in the Forge monorepo. Use for forge.json, the Forge CLI, Vite plugin, SDK (documents, typed Drizzle tables, uploads, webhooks, jobs), error handling, migrations, local registry installation, or site deployment.
---

# Forge

## Quick start

1. Start the local stack: `docker compose up --build`
2. Create config: `forge init <site-id>`
3. Build the site
4. Deploy: `forge deploy`

Services: API at `http://localhost:8787`, NGINX at `http://localhost:8880`.

## Workflows

### Create `forge.json`

`forge.json` lives at the project root:

```json
{
  "siteId": "demo",
  "entry": ".",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true,
  "database": {
    "migrations": "drizzle"
  }
}
```

Generate it with the CLI:

```bash
forge init demo
```

### Decide whether to use the Vite plugin

Use `@ism0080/forge-vite-plugin` when the site is a Vite app and you want `virtual:forge` to inject config values at build time.

Do **not** use it for plain static sites or non-Vite build tools.

```ts
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default {
  plugins: [forgePlugin()],
};
```

### Use the SDK

```ts
import { createClient } from "@ism0080/forge-sdk";

const client = createClient({
  baseUrl: "http://localhost:8787",
  siteId: "demo",
});

const posts = client.db.collection("posts");
await posts.create({ data: { title: "Hello" } });
```

Use `client.db.collection()` for schemaless documents. Use the Drizzle workflow below for typed SQLite tables.

### Search documents

Collection lists accept a `search` term that runs a full-text query over the document JSON:

```ts
const matches = await posts.list({ search: "hello world" });
```

The query goes through a SQLite FTS5 index kept in sync by triggers on create/update/delete. Each whitespace-separated term is quoted before matching, so user input cannot inject FTS operators.

### Upload assets

`client.upload` takes a path and base64 content, decodes it locally, and sends the raw bytes to `POST /api/upload` as `application/octet-stream` with `siteId`, `path`, and optional `contentType` in the query string:

```ts
const result = await client.upload({
  path: "assets/logo.svg",
  contentBase64: base64String,
  contentType: "image/svg+xml",
});
// result.key === "sites/demo/assets/logo.svg"
```

The server never decodes base64. Bodies larger than `UPLOAD_MAX_BYTES` (default 10 MB) are rejected with `413`. `path` is resolved inside the site's `sites/<siteId>/` prefix, and a provided `contentType` is recorded with the object (serving still infers content type from the file extension).

### Handle API errors

Server errors are typed `_tag`-discriminated bodies (`DocumentNotFoundError`, `VersionConflictError`, `JobNotFoundError`, `SchemaRowNotFoundError`, `InternalError`, ...). The promise-based SDK translates them into `ForgeApiError` with a stable `.code`:

```ts
try {
  await posts.get("missing");
} catch (error) {
  if (error instanceof ForgeApiError && error.code === "document not found") {
    // handle
  }
}
```

Codes include `"document not found"`, `"version conflict"`, `"job not found"`, `"row not found"`, and `"not found"`; invalid-input errors surface their server message as the code.

### Schedule jobs

Create cron jobs (5-field expressions evaluated in UTC) that fire through the webhook gateway:

```ts
const job = await client.jobs.create({
  name: "nightly-cleanup",
  schedule: "0 3 * * *",
  payload: { kind: "cleanup" },
});
// job.nextRunAt is an ISO timestamp; version starts at 1

await client.jobs.list();                 // all jobs for the site
await client.jobs.get(job.id);            // by id
await client.jobs.update(job.id, { enabled: false, expectedVersion: job.version });
await client.jobs.run(job.id);            // run immediately
await client.jobs.delete(job.id, job.version + 1);
```

CLI equivalents: `forge jobs list` and `forge jobs run <job-id>`. A background runner scans for due jobs every `JOB_RUNNER_INTERVAL_MS` (default `30000`) while `JOB_RUNNER_ENABLED` (default `true`) is set. Each occurrence is forwarded through the webhook gateway using the same `EXTERNAL_API_URL` / `EXTERNAL_API_KEY` as `client.webhook`, and the job records `lastStatus`, `lastError`, and `runCount`.

### Use SQLite with Drizzle

Install Drizzle in the PWA:

```bash
pnpm add drizzle-orm
pnpm add -D drizzle-kit
```

Define a schema containing Forge's four managed columns:

```ts
// src/db/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todos = sqliteTable("todos", {
  id: text().primaryKey(),
  version: integer().notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  title: text().notNull(),
  completed: integer({ mode: "boolean" }).notNull().default(false),
});
```

Forge generates `id`, initializes and increments `version`, and maintains the timestamps. Callers omit these fields from inserts and patches.

Configure Drizzle Kit:

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

Set `database.migrations` in `forge.json`, then generate and deploy:

```bash
pnpm drizzle-kit generate
forge deploy
```

`forge deploy` applies pending migrations before uploading assets. A migration failure prevents asset deployment. Migration IDs come from paths under the configured directory, files are ordered lexicographically, and applied migration files must remain unchanged and present. Use `forge db push` to apply migrations without deploying assets.

Pass the Drizzle table object to the SDK for inferred types and SQLite value conversion:

```ts
import { createClient } from "@ism0080/forge-sdk";
import { todos } from "./db/schema";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
const todoTable = client.db.table(todos);

const created = await todoTable.insert({ title: "Ship PWA", completed: false });
const fetched = await todoTable.get(created.row.id);
const updated = await todoTable.update(created.row.id, { completed: true }, created.row.version);
await todoTable.delete(updated.row.id, updated.row.version);
```

Subscribe using the same table client:

```ts
const unsubscribe = todoTable.subscribe({
  onCreate: (row) => console.log("Created", row),
  onUpdate: (row) => console.log("Updated", row),
  onDelete: (id) => console.log("Deleted", id),
});
```

Current table operations are `get`, `insert`, `update`, `delete`, and `subscribe`. There is no typed list or arbitrary query API yet; use `client.db.collection()` when its list/filter API is sufficient.

Drizzle tables and `client.db.collection()` both use the same per-site SQLite database.

### Install from the local registry

The monorepo publishes to `http://localhost:4873`.

```bash
pnpm add @ism0080/forge-sdk --registry http://localhost:4873
```

Or add to `.npmrc`:

```ini
@ism0080:registry=http://localhost:4873
```

### Deploy a site

```bash
forge deploy
```

Or without `forge.json`:

```bash
forge deploy ./dist demo
```

Positional deployment does not load `database.migrations`; use `forge.json` for migration-aware deployments.

Use [EXAMPLES.md](EXAMPLES.md) for migration limits, SQLite operations, troubleshooting context, and complete examples.
