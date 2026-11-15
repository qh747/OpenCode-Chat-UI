# Settings panel

Status: implemented

## Question

The extension exposes five VS Code settings, all of them low-frequency and
none of them editable from the panel itself. Everything else the user might
want to change — the default model, whether the context is compacted, how
large an image may be, which shell the agent runs commands in — lives in the
opencode server's own configuration file, which was reachable only by opening
it in an editor and typing JSON.

Should the extension offer a place to change those, and if so what should it
cover?

## Facts established first

- The opencode desktop app has a settings screen with about forty entries.
  Most of them are **client-local** — theme, zoom, fonts, keybinds, sounds,
  layout — and in VS Code every one of them is already owned by VS Code
  (`workbench.colorTheme`, `editor.fontFamily`, `editor.zoomLevel`,
  `workbench.keybindings`). Copying them would produce a second-class copy.
- The server's HTTP surface can write exactly **one** config key: `shell`,
  through `PATCH /api/experimental/config`. `GET /api/config` is read-only.
  The CLI has no general config command either — `opencode config` does not
  exist, `opencode debug config` is read-only.
- So the other keys have to land in `opencode.json` / `opencode.jsonc` on
  disk. Those files are hand-written and carry comments and trailing commas.
- The server watches its config directory and reloads within ~100 ms, then
  broadcasts `config.updated` — the extension already listens for that event.
- The server resolves the global config directory the same way the extension
  can: `OPENCODE_CONFIG_DIR`, then `XDG_CONFIG_HOME/opencode`, then
  `~/.config/opencode`. The extension spawns the server with the same
  environment, so both land on the same file.

## What was decided

**The panel is a separate editor tab, not a floating sheet.** The chat panel
is a narrow strip; a settings surface with two groups, a scope switcher and
text inputs does not fit there. A tab also keeps the settings out of the
conversation's way.

**Two groups, because two different things are being owned.** *Local
preferences* are the extension's own (`opencode.*` in the VS Code
configuration). *Server config* is the opencode server's, written into its
config file. The panel says which is which, and the VS Code settings page
still works on the same keys — the panel is a second front-end for one set of
values, not a second copy of them.

**Thirteen rows, not forty.** The desktop app's client-local entries were
left out (VS Code owns them), and the server's long tail — providers, MCP
servers, agents, plugins — was left out too (it needs a real editor, not a
row with a dropdown). What is left is what a user reaches for often.

**Only explicit values are shown.** A row shows what is written in the file
it edits, and names the server's fallback when the key is absent. Showing
the server's *effective* value would mean re-implementing the merge the
server does — and the server has no general merge helper for nested keys
(`compaction.keep.tokens`), so that copy would drift.

**The scope is switched per group, not per row.** One switch between the
global file and the project's. `shell` is the exception: the server writes it
globally, so the row is greyed out in project scope rather than silently
writing somewhere the server will not read.

**Notifications only fire when nobody is looking.** A turn that finishes
while you are in the chat is not news; a turn that finishes while you are in
the editor is. The webview reports its own focus, and the panel's own
settings decide which events are worth a notification.

## What was implemented

- `src/util/settings-items.ts` — the thirteen rows as one list the host and
  the webview both read.
- `src/util/opencode-config.ts` — reading and editing the config file:
  the global directory, the file the server would pick, and JSONC-safe edits.
- `src/webview/settings-panel.ts` — the host side: reads and writes both
  stores, and pushes the panel's state.
- `webview-ui/SettingsPanel.tsx`, `webview-ui/settings.tsx` — the panel
  itself, in its own bundle (`dist/settings.js`).
- `src/webview/view.ts` — the tab, and `openSettingsTab()`, which focuses
  the existing tab instead of opening a second one.
- `docs/adr/0005-jsonc-parser-for-config-edits.md` — why the extension now
  has a runtime dependency.

## Open

- `OPENCODE_CONFIG_DIR` is read as the config directory itself. The server's
  own resolution was read from the source, but the two have not been run
  side by side with that variable set.
- The shape of `GET /api/config/shell` is not pinned down by the OpenAPI
  document, so the shell entries are mapped defensively and the row falls
  back to a text field when nothing usable comes back.
- The queued-message behaviour (queue vs. steer) is the cheapest useful
  addition left: the extension already does both, and only lacks a switch.
