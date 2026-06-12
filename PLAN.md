# Quick Clone Implementation Plan

## Goal

Build an internal-only hosting platform inspired by Shopify Quick: deploy static sites in seconds and optionally add backend capabilities through a zero-config client API.

## Product Principles

- Keep setup minimal: static files + URL + optional APIs.
- Internal trust boundary first: authenticated org users only.
- Prefer a small, fixed feature set over platform sprawl.
- Make deployment simple: overwrite-based updates.
- Add guardrails early (rate limits, quotas, validation).

## Phase 1: MVP (End-to-End Usable)

### 1) Scope and Constraints

- Internal-only access model.
- No per-site ownership model at launch.
- Overwrite deploy behavior (no versioning initially).

### 2) Static Hosting Foundation

- Store each site under a dedicated namespace (`/sites/{subdomain}/...`).
- Serve static assets through HTTP server/reverse proxy.
- Add wildcard subdomain routing (`{site}.quick.local` -> site namespace).

### 3) Authentication Gate

- Protect all site and API traffic with org auth (SSO/IAP-like).
- Attach trusted user identity to each request context.

### 4) Deploy CLI

- Implement `quick deploy <dir> --site <name>`.
- Sync local files to site namespace.
- Output deployed URL and basic deployment metadata.

### 5) API Server + Browser SDK

- Add `/api/*` backend surface.
- Create lightweight client SDK for browser usage.
- Expose identity context through SDK.

### 6) Database API

- Document collection model with CRUD.
- Support basic list/filter/pagination.
- Enforce site-level data isolation.
- Near-term DB backlog:
  - Add `get/update/delete` endpoints and SDK methods.
  - Add cursor + limit support on list operations.
  - Define DB change event contract for websocket subscriptions.

### 7) Realtime API

- Add websocket endpoint.
- Publish create/update/delete events per site+collection channel.
- Provide client subscribe/unsubscribe helpers.

### 8) Operational Guardrails

- Request logging and error telemetry.
- Rate limits per user/site.
- Input validation and payload limits.

## Phase 2: Core Capability Expansion

### 1) File Uploads

- Upload endpoint or presigned flow.
- Per-site storage namespaces.
- Size/type limits and retention policy.

### 2) AI Proxy API

- Keep provider keys server-side only.
- Expose chat and image generation endpoints.
- Add usage limits and cost controls.

### 3) Identity API

- Return authenticated user details (`id`, `name`, `email`, `team`).
- Optionally add directory lookup utilities.

### 4) Data Warehouse API

- Read-only query endpoint for analytics source.
- Allowlist datasets/tables and enforce timeouts.
- Return normalized, schema-stable JSON.

### 5) CLI and DX Enhancements

- `quick init` starter template.
- `quick dev` local preview mode.
- `quick doctor` diagnostics for auth/config.

### 6) Reliability Improvements

- Static asset caching strategy.
- DB indexing for common access paths.
- Connection limits and websocket backpressure.

## Phase 3: Scale, Governance, and Polish

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

1. Static hosting + wildcard routing
2. Auth gate
3. Deploy CLI
4. Database CRUD
5. Realtime subscriptions
6. File uploads
7. AI proxy
8. Identity API
9. Data warehouse API
10. Quotas, observability, and polish

## Success Criteria

- A user can run deploy once and share a working internal URL.
- A site can store/retrieve data and receive realtime updates.
- A site can call AI APIs without exposing provider secrets.
- Basic abuse controls prevent obvious runaway usage.
- Platform remains simple enough to operate with low overhead.
