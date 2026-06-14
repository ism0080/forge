# Forge Implementation Plan

## Goal

Build an internal-only hosting platform inspired by Shopify Quick: deploy static sites in seconds and optionally add backend capabilities through a zero-config client API.

## Product Principles

- Keep setup minimal: static files + URL + optional APIs.
- Internal trust boundary first: authenticated org users only.
- Prefer a small, fixed feature set over platform sprawl.
- Make deployment simple: overwrite-based updates.
- Add guardrails early (rate limits, quotas, validation).

## Current State

The repo is an end-to-end local scaffold with the following packages:

- `packages/server`: Effect-based API with local filesystem storage and database adapters.
- `packages/cli`: `forge` CLI for `init`, `deploy`, `whoami`, `plugins list`, and `dev`.
- `packages/core`: shared types and schemas for config, DB, identity, and webhooks.
- `packages/sdk`: browser-friendly SDK with DB CRUD, realtime subscriptions, and webhook helpers.
- `packages/vite-plugin`: Vite plugin that exposes `forge.json` values through `virtual:forge`.
- `docker-compose.yml`: local stack with API, persistent storage, and NGINX.

### Implemented

- Static hosting with per-site namespaces (`sites/{siteId}/...`).
- Wildcard subdomain routing via NGINX (`{site}.localhost`) and path-based routing (`/s/{site}/`).
- Site directory page at `/directory`.
- Deploy CLI with `forge.json` support and optional positional `deploy <folder> <site-id>`.
- Pluggable DB service with local file adapter, CRUD endpoints, list/filter/pagination, optimistic concurrency, and websocket event streaming.
- SDK DB client with `create`, `list`, `get`, `update`, `delete`, and `subscribe`.
- File upload endpoint using base64 payloads.
- Webhook gateway that forwards `POST /api/webhook` to an external API.
- Identity endpoint (`/api/whoami`) with dev fallback and health check (`/health`).
- Plugin registry endpoint (`/api/plugins`) listing identity and file capabilities.
- Local npm registry publishing workflow for all public packages.

### Gaps and Backlog

- No real authentication gate; identity is a dev fallback reading `X-Forge-User-*` headers.
- No request logging, error telemetry, rate limits, quotas, or input payload limits beyond Effect schema validation.
- DB has no indexes beyond filesystem layout.
- No static asset caching strategy.
- No AI proxy, data warehouse, or file presigned URL flow.
- No backup/restore or operational dashboards.

## Phase 1: MVP (End-to-End Usable) — Mostly Complete

### 1) Scope and Constraints

- Internal-only access model.
- No per-site ownership model at launch.
- Overwrite deploy behavior (no versioning initially).

### 2) Static Hosting Foundation — Done

- Store each site under a dedicated namespace (`/sites/{subdomain}/...`).
- Serve static assets through HTTP server/reverse proxy.
- Add wildcard subdomain routing (`{site}.quick.local` -> site namespace).

### 3) Authentication Gate — Not Started

- Protect all site and API traffic with org auth (SSO/IAP-like).
- Attach trusted user identity to each request context.

### 4) Deploy CLI — Done

- Implement `quick deploy <dir> --site <name>`.
- Sync local files to site namespace.
- Output deployed URL and basic deployment metadata.

### 5) API Server + Browser SDK — Done

- Add `/api/*` backend surface.
- Create lightweight client SDK for browser usage.
- Expose identity context through SDK.

### 6) Database API — Done

- Document collection model with CRUD.
- Support basic list/filter/pagination.
- Enforce site-level data isolation.

### 7) Realtime API — Done

- Add websocket endpoint.
- Publish create/update/delete events per site+collection channel.
- Provide client subscribe/unsubscribe helpers.

### 8) Operational Guardrails — Not Started

- Request logging and error telemetry.
- Rate limits per user/site.
- Input validation and payload limits.

## Phase 2: Core Capability Expansion — Partially Complete

### 1) File Uploads — Done (Basic)

- Upload endpoint with base64 payloads.
- Per-site storage namespaces.
- Size/type limits and retention policy still needed.

### 2) AI Proxy API — Not Started

- Keep provider keys server-side only.
- Expose chat and image generation endpoints.
- Add usage limits and cost controls.

### 3) Identity API — Partially Done

- Return authenticated user details (`id`, `name`, `email`, `team`).
- Currently dev fallback; needs production trust boundary.
- Optionally add directory lookup utilities.

### 4) Data Warehouse API — Not Started

- Read-only query endpoint for analytics source.
- Allowlist datasets/tables and enforce timeouts.
- Return normalized, schema-stable JSON.

### 5) CLI and DX Enhancements — Partially Done

- `quick init` starter template — Done.
- `quick dev` local preview mode — Done (runs `docker compose up --build`).
- `quick doctor` diagnostics for auth/config — Not Started.

### 6) Reliability Improvements — Not Started

- Static asset caching strategy.
- DB indexing for common access paths.
- Connection limits and websocket backpressure.

## Phase 3: Scale, Governance, and Polish — Not Started

### 1) Governance and Safety

- Quotas for storage, DB volume, websocket usage, API calls.
- Abuse detection and temporary throttling.
- Audit trail for deploys and destructive actions.

### 2) Ecosystem and Discovery

- Internal site directory (search, tags, metadata).
- Shared library publishing/discovery model.
- Curated example apps (polls, leaderboards, collaboration).

### 3) SRE Readiness

- Health checks, SLOs, dashboards, alerting.
- Backup/restore for DB and uploads.
- Dependency failure fallback behaviors.

### 4) Performance and Cost

- Optimize hot paths and runtime choices.
- Compression and asset optimization.
- Infrastructure footprint tuning.

### 5) Developer Experience

- Typed SDK.
- Improved docs and copy-paste snippets.
- Actionable API error codes.

## Recommended Build Order

1. Static hosting + wildcard routing — Done
2. Auth gate — Next
3. Deploy CLI — Done
4. Database CRUD — Done
5. Realtime subscriptions — Done
6. File uploads — Done (basic)
7. AI proxy
8. Identity API production wiring
9. Data warehouse API
10. Quotas, observability, and polish

## Success Criteria

- A user can run deploy once and share a working internal URL.
- A site can store/retrieve data and receive realtime updates.
- A site can call AI APIs without exposing provider secrets.
- Basic abuse controls prevent obvious runaway usage.
- Platform remains simple enough to operate with low overhead.
