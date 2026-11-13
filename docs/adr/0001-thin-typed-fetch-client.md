# ADR-0001: Thin typed fetch client instead of the official `@opencode/client`

- Status: accepted
- Date: 2026-11-14

## Context

The extension talks to a local opencode v2 server over HTTP + SSE. The official client package (`@opencode/client`) is the recommended integration path, but at decision time it had been published for hours, its API shape was unverified, and it is derived from an Effect-based internal stack whose surface may churn between releases.

We had already verified the exact surface we need against the server's own OpenAPI document (`GET /openapi.json`, snapshot kept in `dev/openapi.json`): a handful of session/message/permission/provider endpoints plus one SSE stream.

## Decision

Implement a dependency-free typed client (`src/opencode/client.ts`) and a small SSE consumer with reconnect (`src/opencode/events.ts`) against the verified endpoints, instead of depending on `@opencode/client`.

## Consequences

- Zero runtime dependencies for the extension host; the webview only bundles React/marked/dompurify.
- Server upgrades that change or remove endpoints break loudly at our client layer, which is visible in our own code rather than behind a vendor package's API drift.
- When the official client stabilizes, migrating is a contained change behind `OpencodeClient`.
- We must re-verify the OpenAPI snapshot after notable opencode releases (see ADR-0002 for the version gate).
