# OpenCode for VS Code

A [VS Code](https://code.visualstudio.com) extension that brings a [CommandCode](https://commandcode.ai)-style chat experience to your local [opencode](https://opencode.ai) CLI — reusing the login you already have, including **OpenCode Go subscriptions**.

![UI](https://img.shields.io/badge/opencode-v2-8A2BE2) ![license](https://img.shields.io/badge/license-MIT-green)

> Community integration, not an official opencode product. CommandCode is a closed-source product with its own subscription; this extension gives you a similar IDE experience on top of your own opencode install.

## Features

- **Chat panel** (secondary sidebar by default, movable anywhere) with streaming replies, markdown, collapsible thinking and tool cards.
- **Sessions tree** grouped by date with open / rename / delete.
- **Native diffs** — changes open in VS Code's diff editor; keep or revert per file.
- **Permission cards** — Allow once / Always allow / Deny, powered by opencode's permission API.
- **Model & mode pickers** — every provider configured in opencode (including `opencode-go/*` subscription models) plus the native agents (build / plan / custom agents). `Shift+Tab` cycles modes.
- **Context** — `@` to fuzzy-attach files, `+` for a multi-file picker, auto-attach of the active editor selection.
- **Plan handoff** — finish exploring in plan mode, then one click switches to build and executes.
- **Zero account handling** — the extension spawns a private `opencode serve` per window (random port + random password, killed with the window) or connects to an existing server; auth stays in your opencode CLI login.

## Requirements

- [opencode CLI](https://opencode.ai/docs) v2.x installed and logged in (`opencode auth login`). On Windows without a CLI in `PATH`, the extension falls back to the CLI bundled inside the OpenCode desktop app.
- VS Code 1.106+.

## Getting started

1. Install the VSIX: `code --install-extension opencode-vscode-0.1.0.vsix` (or F5 in this repo).
2. Open a workspace folder. The extension starts an opencode server for it.
3. Click the OpenCode icon in the activity bar (bottom icon group) and start chatting.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencode.path` | `""` | Override the opencode binary path (auto-detected otherwise). |
| `opencode.serverUrl` | `""` | Connect to an already running opencode v2 server instead of spawning one. |
| `opencode.serverPassword` | `""` | Password for the external server (basic-auth user is always `opencode`). |
| `opencode.context.autoAttachSelection` | `true` | Attach the active editor's selection as context. |
| `opencode.context.maxSelectionLength` | `2000` | Max characters of a selection to attach. |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+Shift+'` | Focus the chat |
| `Shift+Tab` (in composer) | Cycle agent modes |
| `Enter` / `Shift+Enter` | Send / newline |

## Development

```bash
npm install
npm run compile      # build extension + webview
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # unit tests (node:test)
npm run package      # vsce package
```

Launch with **F5** (Run → Start Debugging) for a dev host with the extension loaded.

The v2 HTTP API used here was verified against opencode 2.2.7's own OpenAPI document (`GET /openapi.json` on the server); `dev/openapi.json` is kept as a reference snapshot.

## Roadmap (v2)

- Image attachments (paste / drag, up to 6)
- Session fork / rewind (message-level revert) / transcript export
- Reasoning-effort selector
- Four permission presets (auto-accept edits / full access)
- Terminal CLI bridge (`/ide`-style)

## License

[MIT](LICENSE)
