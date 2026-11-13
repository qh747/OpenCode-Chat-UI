# ADR-0002: Warn, don't block, on opencode major-version mismatch

- Status: accepted
- Date: 2026-11-14

## Context

The extension consumes the opencode v2 HTTP API (`/api/*`). opencode releases frequently (2.2.7 → 2.3.0 verified compatible for our endpoint set), and a future v3 could move or reshape endpoints. Users upgrade their CLI independently of this extension.

Options considered: hard-block on mismatch (safest, but locks users out of newer servers the extension may actually work with); no check at all (failures surface as raw API errors with no guidance).

## Decision

Read the server version from `GET /api/info` on connect. If the major version differs from the tested range (v2), show a **non-blocking warning banner** in the chat and continue operating. Connection failures and API errors keep their own explicit messaging (install guide, logs).

## Consequences

- Users on an untested future major get a visible signal plus working functionality when the API happens to be compatible.
- The extension never soft-locks against a server it could serve.
- Regression risk on major upgrades is carried by our integration tests against the OpenAPI snapshot rather than a version check that pretends to guarantee compatibility.
