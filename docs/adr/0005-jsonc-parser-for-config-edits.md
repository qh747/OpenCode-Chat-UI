# ADR-0005: Edit the opencode config file with `jsonc-parser`

- Status: accepted
- Date: 2026-11-15

## Context

The settings panel edits the opencode server's own configuration. The server's
HTTP surface can write exactly one key — `shell`, through
`PATCH /api/experimental/config` — and every other key has to land in the
config file (`opencode.json` / `opencode.jsonc`) on disk. The CLI has no
general config command either: `opencode config` does not exist, and
`opencode debug config` is read-only.

Those files are hand-written — they carry comments, trailing commas and a
layout the user chose. Rewriting one with `JSON.parse` + `JSON.stringify`
would silently drop all of that, in the user's global config as much as in a
project's.

ADR-0001 established a dependency-free extension host, so adding a package is
not free. Hand-writing a JSONC editor that preserves comments is roughly
250–400 lines and has to get string escapes, trailing commas, insertion
indentation and edit-offset drift right.

## Decision

Use `jsonc-parser` — the same library the opencode server uses to write its
own config (`packages/core/src/config.ts` and four other places) — to edit the
file. Its `modify()` computes character-offset edits and `applyEdits()`
applies them, so everything outside the edited range survives byte for byte.

This amends one consequence of ADR-0001: the extension host now has one
runtime dependency, `jsonc-parser` (MIT, Microsoft, no transitive
dependencies, ~6.5 KB gzipped). The decision to hand-write the HTTP client
stands — that was about `@opencode/client`'s API churn, not about dependency
count as such.

## Consequences

- The user's comments and formatting survive an edit made from VS Code.
- The extension and the server agree on what a config edit means, because they
  run the same code.
- `jsonc-parser`'s UMD build shadows `require` inside its factory, so esbuild
  cannot follow it; the bundler resolves the package's ESM build instead
  (`mainFields: ["module", "main"]`).
- The extension now has a dependency to keep current, and ADR-0001's
  zero-dependency property no longer holds.
