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
import { apiBaseUrl, baseUrl, siteId, spa, entry } from "virtual:forge";

const client = createClient({ baseUrl: apiBaseUrl, siteId });
```

Options:

```ts
forgePlugin({
  configPath: "./forge.json", // default
  base: "./",                  // default Vite base
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

### Webhooks

```ts
const result = await client.webhook({
  title: "New post",
  message: "A post was published",
  payload: { postId: "123" },
});
```

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

# Show current identity
forge whoami

# List server plugins and capabilities
forge plugins list

# Start the local docker stack
forge dev
```

Set `FORGE_API_BASE_URL` to target a different API:

```bash
FORGE_API_BASE_URL=http://api.example.com forge deploy
```
