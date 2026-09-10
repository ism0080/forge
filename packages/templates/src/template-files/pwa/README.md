# Forge PWA starter

A React PWA starter backed by Forge's SQLite storage with Drizzle.

## Database

This template owns its schema with Drizzle. The `notes` table in
`src/db/schema.ts` uses Forge's four managed columns — `id`, `version`,
`createdAt`, and `updatedAt` — which Forge generates and maintains for you.

`forge init` writes `forge.json` with the migration directory and build output
already wired, so deploys apply pending migrations before assets are uploaded:

```json
{
  "siteId": "{{siteId}}",
  "entry": "dist",
  "apiBaseUrl": "http://localhost:8787",
  "spa": true,
  "database": {
    "migrations": "drizzle"
  }
}
```

The Vite plugin serves the app under `/s/{{siteId}}/` and points the TanStack
Router at the same base path.

Generate migrations after changing the schema, build, then deploy (or run
`forge db push` to apply migrations without uploading assets):

```bash
pnpm db:generate
pnpm build
forge deploy
```

The home route reads and writes notes through the typed `client.db.table(notes)`
client from `@ism0080/forge-sdk`.