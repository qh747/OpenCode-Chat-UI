# 01 — A settings panel for the extension and the server's config

Status: resolved

Type: task

## Problem

Two kinds of setting were both out of reach:

- the extension's own five `opencode.*` settings, editable only through
  VS Code's settings page, which is a modal away from the chat;
- the opencode server's configuration — default model, compaction, snapshot
  and formatter switches, image and tool-output limits, instruction files,
  the shell — editable only by opening `opencode.json` in an editor and
  typing JSON.

The desktop app solves the second problem with a settings screen. Copying it
wholesale would have been wrong: about forty of its entries are client-local
(theme, zoom, fonts, keybinds, sounds) and VS Code already owns every one of
them.

## Approach

Ask first, then build.

The panel was settled through a grilling round: a separate editor tab rather
than a floating sheet; local preferences and server config in two groups;
thirteen rows rather than a catalogue; explicit values only, with the
server's fallback named; one scope switch for the whole server group; and
notifications that only fire when the chat is not being looked at.

Two facts changed the shape of the work mid-way:

- the server can only write `shell` over HTTP, so everything else has to be
  written into the config file — and that file is hand-written, so the edit
  has to preserve comments;
- `vscode.Webview` has no focus event, so the webview reports its own focus
  to the host instead.

## Answer

The panel ships as described. The config file is edited with `jsonc-parser`,
the same library the server uses, so a user's comments survive an edit made
from VS Code (ADR-0005). The file the server would pick is the file the
extension picks: `opencode.jsonc` when it exists, `opencode.json` otherwise,
`opencode.jsonc` when neither does — the server's rule, not the CLI's, since
the server is what reads the file.

Notifications hang off three signals in the chat controller: the turn going
idle, a pending permission appearing, and a turn failing. Each is gated by
its own setting and skipped while a chat surface holds focus.

## How this was verified

- `test/opencode-config.test.ts` — the directory resolution, the file
  selection, reading top-level and nested and array values, and the write
  path: a comment next to an untouched key survives, a nested key does not
  disturb its siblings, a missing parent object is created, `undefined`
  removes the key, and a broken file is refused instead of overwritten.
- `test/settings-render.test.ts` — the rendered panel: every row present,
  local preferences first, the control that matches each row's type, the
  "not set (server default: …)" wording, the scope switcher, a global-only
  row greyed out in project scope, and the external-server warning.
- The panel itself was exercised by hand in the extension host: the gear
  button opens the tab, the second press focuses it instead of opening a
  second one, the scope switch re-reads the other file, and an edited key
  shows up in the file with the surrounding comments intact.
