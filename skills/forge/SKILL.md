---
name: forge
description: Helps develop, configure, and deploy sites in the Forge monorepo. Use when the user asks about forge.json config, the @ism0080/forge-vite-plugin, the @ism0080/forge-sdk, installing from the local registry, or deploying a site with the forge CLI.
---

# Forge

## Quick start

1. Start the local stack: `docker compose up --build`
2. Create config: `forge init <site-id>`
3. Deploy: `forge deploy`

Services: API at `http://localhost:8787`, NGINX at `http://localhost:8080`.

## Workflows

### Create `forge.json`

`forge.json` lives at the project root:

```json
{
  "siteId": "demo",
  "entry": ".",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true
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

See [EXAMPLES.md](EXAMPLES.md) for full CLI, SDK, Vite plugin, and local registry workflows.
