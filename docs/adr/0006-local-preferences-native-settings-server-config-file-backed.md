# ADR-0006: Local preferences live in native settings; server config stays file-backed

- Status: accepted
- Date: 2026-11-15

## Context

The settings surface has two kinds of values (see GLOSSARY: local preference
vs server config). A native VS Code settings page can only edit keys in the VS
Code configuration store; it cannot write `opencode.json(c)` — and it cannot
offer the model/agent/shell pickers, whose options come from the live server
catalog (ADR-0005 covers why those values must land in the config file).

## Decision

Split the surface by who owns the value. The extension's own preferences (the
`opencode.*` keys: notifications, context, connection) are declared in
`contributes.configuration` and edited on the native VS Code settings page —
`opencode.openSettings` opens it filtered to this extension. The opencode
server's configuration keeps the dedicated webview panel
(`opencode.openServerConfig`), which stays the only place rows write to the
server's config file.

UI copy follows the VS Code display language: `package.nls.*` for the native
settings descriptions, a shared dictionary (`src/util/i18n.ts`) for everything
else, resolved from `vscode.env.language`.

## Consequences

- Two settings entries exist in the command palette; the chat header's gear
  opens the server config panel, the palette's "OpenCode: Settings" the native
  page.
- Server config cannot be fully localized through `package.nls` alone; the
  webview dictionary carries its share.

## Considered options

Mirroring the server config as `opencode.server.*` VS Code settings and writing
them through to the config file was rejected: two sources of truth drift apart
(hand-edited files, external servers that read their own config, the
global-only `shell` key), and the live catalog pickers would degrade into
static enums. Dropping the server-config UI entirely was rejected too — the
catalog-driven pickers are the panel's main value.
