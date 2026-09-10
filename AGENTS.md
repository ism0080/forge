# Agent guide

Conventions for working in this project. Read before making changes.

## Stack

- Vite + TypeScript (strict)
- Tailwind CSS v4
- pnpm for dependencies
- oxlint for linting, oxfmt for formatting, tsc for typechecking
- Deployed with the Forge CLI — `forge.json` at the project root

The PWA template adds React 19, TanStack Query and TanStack Router, shadcn/ui
components on Base UI, and vite-plugin-pwa.

## Commands

- `pnpm dev` — start the Vite dev server
- `pnpm build` — production build
- `pnpm lint` — oxlint (uses `oxlint.config.ts`)
- `pnpm format` — oxfmt
- `pnpm typecheck` — TypeScript check
- `pnpm env:check` — validate `/env.schema` with varlock

Run `pnpm lint`, `pnpm typecheck`, and `pnpm env:check` before finishing a change.

## Conventions

- Strict TypeScript only. No `any`; avoid implicit `unknown` parameters or returns.
- Import with the `@/` alias, which maps to `src/`.
- UI components live in `src/components/ui/` and are owned by this project
  (shadcn-style copy-in). Edit them in place; do not add wrapper components.
- Merge classes with `cn()` from `@/lib/utils`.
- Dark mode is driven by `prefers-color-scheme` via CSS variables in `src/globals.css`.

## Environment

Environment variables are declared in the root `.env.schema` and resolved with
[varlock](https://varlock.dev). The schema is the single source of truth — keep
it accurate and never put secret values in it. Local overrides go in `.env.local`
(git-ignored); process env vars always win. The server imports
`varlock/auto-load`, so env is validated and injected at boot.

## Lint rules

`oxlint.config.ts` registers the `forge` plugin (`@ism0080/oxlint-plugin-forge`)
and enables its profiles:

- `core` — TypeScript anti-slop rules: no `array.filter().map()` chains, no
  object or `unknown` parameters/returns, no unsafe dictionary types, no silent
  type assertions (a safety comment is required), and more.
- `react` (PWA template) — `forge/no-fixed-height-on-content`: content-bearing
  elements must size themselves from line-height and padding. Use `min-h-*` or
  the approved control heights (`h-6 h-8 h-9 h-10`, `size-3 size-4 size-6
size-8 size-9 size-10`). Do not disable rules to work around violations.

## Versioning

Every published `@ism0080/*` package shares one version. Any change under
`packages/**` must bump them all before committing: run `pnpm version:all`
(patch by default; `pnpm version:all minor` for a minor). `pnpm test` enforces
this — it fails if the versions drift, or if packages changed since the last
`vX.Y.Z` tag without a bump.

## Dependencies

The `@ism0080/*` packages (`forge-sdk`, `forge-vite-plugin`,
`oxlint-plugin-forge`) are published to the registry configured in `.npmrc`.
Install new dependencies with `pnpm add`.
