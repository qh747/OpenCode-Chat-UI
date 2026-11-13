# Changelog

## 0.1.0

Initial release.

- Chat webview view (secondary sidebar by default, movable to the activity bar container or editor tabs) with streaming replies, markdown rendering, collapsible reasoning and tool cards.
- Sessions tree with date grouping, open / rename / delete.
- Native VS Code diff editors for file changes, with per-file Keep / Revert.
- Inline permission cards (Allow once / Always allow / Deny) backed by the opencode permission API.
- Model picker (all configured providers, including OpenCode Go subscription models) and native agent modes (build / plan / custom), Shift+Tab to cycle.
- `@` file mention with fuzzy search, "+" multi-file attach, auto-attach of the active editor selection.
- Automatic `opencode serve` lifecycle per window (random port, random password) or connection to an external server via settings.
- Plan-mode handoff: "Proceed with the plan in build mode".
- Works on Windows, Linux and WSL/SSH remote workspaces (the extension runs in the workspace host).
