# OpenCode Sidebar

English | [简体中文](README.zh-CN.md)

A [VS Code](https://code.visualstudio.com) extension that puts a full [opencode](https://opencode.ai) v2 chat into your editor — streaming replies, native diffs, session management and permission prompts, reusing the login you already have (including **OpenCode Go subscriptions**).

> Community integration, not an official opencode product.

![OpenCode panel open in a VS Code editor tab, next to the welcome screen](images/panel-locations.png)

**One panel, anywhere.** The chat opens in the secondary sidebar (assistant view) or as an editor tab — drag it wherever you work.

## Features

- **Chat panel** (secondary sidebar, movable anywhere) with streaming replies, markdown, collapsible thinking and tool cards.
- **Session history** — main sessions grouped by date with open / rename / delete / fork / export; subagent sessions stay out of the menu and are watched in the chat.
- **Complete transcript** — scrolling up backfills older messages of a long session, and export always writes the whole conversation.
- **Image attachments** — paste or drag up to 6 images per message.
- **Rewind** — revert a session to just before any message (file changes included).
- **Native diffs** — changes open in VS Code's diff editor; revert per file, and a reverted file stays dismissed in that session.
- **Subagents** — running subagents are listed above the composer with their state (yellow = waiting on permission, red = failed); click a row to watch that subagent, and a back chevron returns to its parent. The subagent view hides the diff, queue and subagent strips.
- **Permission cards** — Allow once / Always allow / Deny, powered by opencode's permission API.
- **Model & mode pickers** — every provider configured in opencode (including `opencode-go/*` subscription models), reasoning-effort variants, and the native agents (build / plan / custom). `Shift+Tab` cycles modes.
- **Context** — `@` to fuzzy-attach files, `+` for a multi-file picker, auto-attach of the active editor selection, and a context strip whose branch follows the agent's session directory or worktree.
- **Version guard** — warns (non-blocking) if the connected server's major version is outside the tested v2 range.
- **Zero account handling** — the extension spawns a private `opencode serve` per window (random port + random password, killed with the window) or connects to an existing server; auth stays in your opencode CLI login.

## Requirements

- [opencode CLI](https://opencode.ai/docs) **v2.x** installed and logged in (`opencode auth login`). On Windows without a CLI in `PATH`, the extension falls back to the CLI bundled inside the OpenCode desktop app. An opencode **v1** server is detected and rejected with upgrade guidance (`opencode upgrade`).
- VS Code 1.106+.

## Getting started

1. Install the VSIX from `dist/` (see below) or press **F5** in this repo.
2. Open a workspace folder. The extension starts an opencode server for it.
3. Use **Ctrl/Cmd+Shift+'** or the status bar item to open the chat.

## Packaging

```bash
npm run release      # typecheck + lint + tests + compile + VSIX
```

The artifact lands at `dist/opencode-sidebar-<version>.vsix`. Install it with:

```bash
code --install-extension dist/opencode-sidebar-<version>.vsix
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `opencode.path` | `""` | Override the opencode binary path (auto-detected otherwise). |
| `opencode.serverUrl` | `""` | Connect to an already running opencode v2 server instead of spawning one. |
| `opencode.context.autoAttachSelection` | `true` | Attach the active editor's selection as context. |
| `opencode.context.maxSelectionLength` | `2000` | Max characters of a selection to attach. |
| `opencode.notifications.turnComplete` | `true` | Notify when a turn finishes. |
| `opencode.notifications.permissionRequest` | `true` | Notify when the agent asks for permission. |
| `opencode.notifications.errors` | `false` | Notify when the agent or the server reports an error. |
| `opencode.composer.submitKey` | `enter` | Key that sends from the composer: `enter` or `ctrlEnter` (⌘Enter on macOS). |
| `opencode.composer.showContextBar` | `true` | Show the info bar under the composer (branch, path, context usage). |
| `opencode.diffList.maxVisibleRows` | `5` | Rows the expanded changed-files list shows before it scrolls. |
| `opencode.ui.preferredLocation` | `sidebar` | Where **OpenCode: Open** and the status bar button point: `sidebar` or `editor`. |
| `opencode.startup.autoOpen` | `false` | Open the chat panel when a workspace opens. |

The gear button in the chat header opens a settings panel. It edits these
settings together with the opencode server's own configuration
(`opencode.json`), in one place — including `experimental.subagent_depth`
(default 1), the switch that stops a subagent from spawning further subagents.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd+Shift+'` | Focus the chat |
| `Shift+Tab` (in composer) | Cycle agent modes |
| `Enter` | Send when the cursor is at the end; confirm a `/` or `@` completion when it is mid-text (see `opencode.composer.submitKey`) |
| `Shift+Enter` | Newline |

## Development

```bash
npm install
npm run compile      # build extension + webview
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # unit tests (node:test)
npm run release      # full verification pipeline + VSIX into dist/
```

Launch with **F5** (Run → Start Debugging) for a dev host with the extension loaded.

The v2 HTTP API used here was verified against opencode 2.2.7/2.3.0's own OpenAPI document (`GET /openapi.json` on the server); `dev/openapi.json` is kept as a reference snapshot. See `docs/adr/` for architecture decisions and `GLOSSARY.md` for terminology.

## Note: pay-as-you-go vs subscription

opencode's default model may live on the `opencode` pay-as-you-go provider — if that balance is empty, turns fail immediately with 402 "Insufficient balance". Your subscription models live under the `opencode-go` provider; pick an `opencode-go/*` model in the model picker to use your Go plan.

## Roadmap

- Message-level history search
- Four permission presets (auto-accept edits / full access)
- Terminal CLI bridge (`/ide`-style)
- Session import

## License

[MIT](LICENSE)
