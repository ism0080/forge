# Forge Examples

## `forge.json`

Minimal valid config:

```json
{
  "siteId": "demo",
  "entry": ".",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true
}
```

Fields:

- `siteId` (string, required): unique site identifier
- `entry` (string, required): folder to deploy, relative to project root
- `apiBaseUrl` (string, required): Forge API base URL
- `spa` (boolean, optional, default `true`): serve `index.html` on route misses

Override the API base URL with the environment variable `FORGE_API_BASE_URL`.

## Vite plugin

Install:

```bash
pnpm add @ism0080/forge-vite-plugin
```

Add to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { forgePlugin } from "@ism0080/forge-vite-plugin";

export default defineConfig({
  plugins: [forgePlugin()],
});
```

Use the virtual module in application code:

```ts
import { apiBaseUrl, baseUrl, siteId, basePath, spa, entry } from "virtual:forge";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
```

Sites are served under `/s/<siteId>/`. The plugin sets Vite's `base` to that
subpath and exposes it as `basePath`; configure client-side routers with it:

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

## SDK

Install:

```bash
pnpm add @ism0080/forge-sdk
```

Create a client:

```ts
import { createClient } from "@ism0080/forge-sdk";

const client = createClient({
  baseUrl: "http://localhost:8787",
  siteId: "demo",
});
```

### Collection operations

```ts
const posts = client.db.collection("posts");

// Create
const doc = await posts.create({
  data: { title: "Hello", status: "draft" },
});

// List with filters and sorting
const page = await posts.list({
  limit: 20,
  whereField: "status",
  whereValue: "draft",
  sortBy: "createdAt",
  sortDir: "desc",
});

// Full-text search over the document JSON (SQLite FTS5, kept in sync by triggers)
const matches = await posts.list({ search: "hello world" });

// Get
const fetched = await posts.get(doc.id);

// Update with optimistic concurrency
const updated = await posts.update(doc.id, {
  data: { ...doc.data, status: "published" },
  expectedVersion: doc.version,
});

// Delete
await posts.delete(updated.id, { expectedVersion: updated.version });
```

### Real-time subscriptions

```ts
const unsubscribe = posts.subscribe({
  onCreate: (doc) => console.log("New:", doc),
  onUpdate: (doc) => console.log("Updated:", doc),
  onDelete: (id) => console.log("Deleted:", id),
  onEvent: (event) => console.log("Event:", event),
  onOpen: () => console.log("Connected"),
  onError: (event) => console.error("Error:", event),
  onClose: (event) => console.log("Closed:", event),
});

// Later
unsubscribe();
```

Schema tables stream the same way — inserts, updates, and deletes emit row events after the write commits:

```ts
const messages = client.db.table<MessageRow>("messages");

const unsubscribeRows = messages.subscribe({
  onCreate: (row) => console.log("Row:", row),
  onUpdate: (row) => console.log("Row updated:", row),
  onDelete: (id) => console.log("Row deleted:", id),
  onOpen: () => console.log("Connected"),
});

unsubscribeRows();
```

### Webhooks

```ts
const result = await client.webhook({
  title: "New post",
  message: "A post was published",
  payload: { postId: "123" },
});
```

### Uploads

```ts
const result = await client.upload({
  path: "assets/logo.svg",
  contentBase64: base64String,
  contentType: "image/svg+xml",
});
// result.key === "sites/demo/assets/logo.svg"
```

The SDK decodes the base64 locally and sends raw bytes to `POST /api/upload` as `application/octet-stream`, with `siteId`, `path`, and optional `contentType` as query parameters. The server does not decode base64. Bodies larger than `UPLOAD_MAX_BYTES` (default `10000000`) are rejected with a `413` `UploadTooLargeError`. `path` is scoped under `sites/<siteId>/`; a provided `contentType` is recorded with the object, though serving still infers content type from the file extension.

### Scheduled jobs

Per-site cron jobs run on a schedule and forward each occurrence through the webhook gateway:

```ts
const job = await client.jobs.create({
  name: "nightly-cleanup",
  schedule: "0 3 * * *",
  payload: { kind: "cleanup" },
});

await client.jobs.list();                 // all jobs for the site
await client.jobs.get(job.id);            // by id
await client.jobs.update(job.id, { enabled: false, expectedVersion: job.version });
await client.jobs.run(job.id);            // run immediately
await client.jobs.delete(job.id, job.version + 1);
```

Schedules are 5-field cron expressions (`minute hour day month weekday`) evaluated in UTC. A background runner scans for due jobs every `JOB_RUNNER_INTERVAL_MS` (default `30000`) while `JOB_RUNNER_ENABLED` (default `true`). Each run is forwarded through the webhook gateway (the same `EXTERNAL_API_URL` / `EXTERNAL_API_KEY` as webhooks); the job records `lastStatus`, `lastError`, and `runCount`. CLI: `forge jobs list`, `forge jobs run <job-id>`.

## Database

### SQLite storage engine

Each site persists to one SQLite file under the database root:

```
data/db/{siteId}.sqlite
```

Storage is server-side configuration; site code and the SDK collection API above are unchanged:

| Variable                | Default     | Description                                                          |
| ----------------------- | ----------- | -------------------------------------------------------------------- |
| `DATABASE_ROOT`         | `./data/db` | Directory holding `{siteId}.sqlite` files                            |
| `SITE_DB_IDLE_TTL_MS`   | `300000`    | Milliseconds an idle per-site SQLite connection stays open before it is closed and reaped |

Migration safeguards are configurable with `DB_MIGRATION_MAX_COUNT` (default `100`), `DB_MIGRATION_MAX_BYTES` (default `1000000`), `DB_MIGRATION_MAX_BUNDLE_BYTES` (default `5000000`), and `DB_MIGRATION_TIMEOUT_MS` (default `30000`). The timeout is checked between SQLite statements; `node:sqlite` cannot interrupt a synchronous statement already in progress.

Set in `docker-compose.yml` or `.env`:

```yaml
services:
  api:
    environment:
      DATABASE_ROOT: /app/data/db
```

The SQLite engine runs in WAL mode with a 5s busy timeout, so reads continue during writes. List queries paginate with keyset seeks on indexed columns instead of rescanning, and `expectedVersion` checks run inside transactions. Use SQLite's online backup API or `VACUUM INTO` for a live backup; copying only the `.sqlite` file can omit committed data still held in the WAL. Stop the server before deleting a site database.

### Drizzle schema and migrations

The PWA owns its schema with Drizzle. Forge applies Drizzle Kit's generated SQL to that site's SQLite database during deployment.

```ts
// src/db/schema.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  id: text().primaryKey(),
  version: integer().notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  body: text().notNull(),
  pinned: integer({ mode: "boolean" }).notNull().default(false),
  meta: text({ mode: "json" }).$type<{ tags: string[] }>(),
});
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

Configure the generated migration directory in `forge.json`:

```json
{
  "siteId": "messages",
  "entry": "dist",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true,
  "database": { "migrations": "drizzle" }
}
```

Generate migrations after changing the schema. `forge deploy` applies pending migrations before uploading assets. Applied migration files are immutable; Forge rejects changed, removed, or reordered migrations.

```bash
pnpm drizzle-kit generate
forge deploy

# Apply migrations without deploying assets
forge db push
forge db push ./drizzle
```

### Typed rows through the SDK

Pass the Drizzle table object to the SDK. Forge infers select and insert types, maps property names to SQLite column names, and encodes boolean and JSON columns.

```ts
import { createClient } from "@ism0080/forge-sdk";
import { messages } from "./db/schema";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
const messageTable = client.db.table(messages);

const inserted = await messageTable.insert({
  body: "Hello",
  pinned: false,
  meta: { tags: ["intro"] },
});
const fetched = await messageTable.get(inserted.row.id);
const updated = await messageTable.update(
  inserted.row.id,
  { body: "Edited" },
  inserted.row.version,
);
await messageTable.delete(inserted.row.id, updated.row.version);
```

List rows with keyset pagination, newest first by default:

```ts
const { rows, nextCursor } = await messageTable.list({ sortDir: "desc", limit: 20 });
// rows: Array<MessageRow>; nextCursor: string | undefined
```

`list` orders by the table's `created_at`/`createdAt` column (using `id` as a tiebreaker), supports `limit`, `cursor`, and `sortDir` (`asc`/`desc`), and returns the raw managed columns decoded through the Drizzle table mapping. Pass `nextCursor` back as `cursor` to fetch the next page. Tables without a `created_at` or `createdAt` column cannot be listed.

Forge manages `id`, `version`, `createdAt`, and `updatedAt`; define all four columns in tables used through `client.db.table()`. Errors surface as HTTP status codes: `400` for invalid input or migration history, `404` for missing rows, `409` for version conflicts, and `413` for uploads over `UPLOAD_MAX_BYTES`. Error bodies are `_tag`-discriminated (`DocumentNotFoundError`, `VersionConflictError`, `SchemaRowNotFoundError`, `InternalError`, ...). The SDK maps them to `ForgeApiError` with stable `.code` strings such as `"document not found"`, `"version conflict"`, `"row not found"`, and `"job not found"`; invalid-input errors use their server message as the code.

## Local registry

The packages `@ism0080/forge-cli`, `@ism0080/forge-sdk`, `@ism0080/forge-vite-plugin`, and `@ism0080/forge-core` publish to `http://localhost:4873`.

Publish from the monorepo:

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

## CLI

Build the CLI:

```bash
pnpm --filter @ism0080/forge-cli build
```

Commands:

```bash
# Initialize a site (creates forge.json and a default index.html)
forge init demo

# Deploy using forge.json
forge deploy

# Deploy without forge.json
forge deploy ./dist demo

# Apply configured Drizzle migrations
forge db push

# List server plugins and capabilities
forge plugins list

# Start the local docker stack
forge dev
```

Set `FORGE_API_BASE_URL` to target a different API:

```bash
FORGE_API_BASE_URL=http://api.example.com forge deploy
```
