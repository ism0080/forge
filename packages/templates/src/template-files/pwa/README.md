# Forge PWA starter

A React PWA starter backed by Forge's SQLite storage with Drizzle.

## Database

This template owns its schema with Drizzle. The `notes` table in
`src/db/schema.ts` uses Forge's four managed columns — `id`, `version`,
`createdAt`, and `updatedAt` — which Forge generates and maintains for you.

Wire the migration directory into `forge.json` so deploys apply pending
migrations before assets are uploaded:

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

Generate migrations after changing the schema, then deploy (or run
`forge db push` to apply migrations without uploading assets):

```bash
pnpm db:generate
forge deploy
```

The home route reads and writes notes through the typed `client.db.table(notes)`
client from `@ism0080/forge-sdk`.