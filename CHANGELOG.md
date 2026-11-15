# Changelog

## 0.4.10

- The context strip's git branch and workspace path are actionable now: clicking the branch switches the workbench to the Source Control view, and clicking the path reveals the workspace folder in the Explorer (falling back to a plain view switch when reveal is unavailable). Both hover with a brighten and carry tooltips; without a git branch the notice stays inert.

## 0.4.9

- Session info aligns with the desktop view in two details: the system prompt shown is the session's LAST system message, trimmed (a whitespace-only notice no longer surfaces an empty block), and "last activity" shows the latest billed turn's time rather than the session's `time.updated`, matching the figure the desktop renders.

## 0.4.8

- Clicking the usage segment in the context strip (`43k / 1.0M | 95%`) opens a session-info slide-over mirroring the opencode desktop's session view: the two-column stat grid (session, provider, model, context limit and usage, the token breakdown of the latest billed turn, message counts, cost, timestamps), the session's system prompt collapsed by default, and the raw message list — one row per message, expandable to its text — with an export button. In a narrow sidebar the grid folds to one column.

- Skills are picked from the slash-command menu: `/` now lists the server's skills below the commands, filtered as you type, keyboard-selectable. Selecting one inserts the skill mention `@<id>` so the message can carry more context before it is sent; sending `/skill-id arguments` directly starts the turn with that mention.
- Fixed: the `@` mention picker showed skills by their display name, but the server resolves mentions by the skill's id — which often differs (`OpenCode` vs `opencode`, `Report` vs `report`), so selected skills could fail to load. Mentions now always spell the id; the display name is shown in the row.
- The `@` picker is files-only now; skills live only in the `/` picker.

- The expanded changed-files list no longer stretches the panel: rows beyond `opencode.diffList.maxVisibleRows` (default 5) scroll inside the card behind a thin scrollbar themed to match the panel. Fewer files than the cap render exactly as before.

## 0.4.5

- The cost figure in the context strip is gone. The opencode server never reported a cost for subscription models (`session.cost` stays 0 no matter what the turn used), so the strip showed a frozen `$0.0000` that no plugin-side change could fix. In its place the strip now shows the cache hit rate of the latest billed turn — the share of prompt tokens the provider served from its prompt cache, e.g. `43k / 1.0M | 95%` — which the same message that feeds the context gauge carries. If the server starts reporting real costs again, this is where a cost readout could return.

## 0.4.4

- The context strip's usage figure was the session's cumulative token total, which grows with every turn and means nothing against the context window — it could read `2.6M / 1.0M`. It now shows the tokens of the latest billed assistant message (input + output + reasoning + cache), the same number the opencode web UI uses for its context gauge, so the figure is the context the next turn will start from. A rewind stops the count at the revert point, and a completed compaction discards the usage it replaced.
- The strip now updates at the end of every turn, not only when the session is reopened (0.4.3 fix, kept).

## 0.4.3

- The changed-files list is collapsed by default: one quiet row — `▸ CHANGES 2 · +31 -4` — that expands into the per-file Keep / Revert on click. The counts are the signal; the rows are only for acting on one file. It used to sit above the composer fully expanded after every turn, one row per file, until each was dealt with.
- Fixed: a file you had kept never came back, even when the agent changed it again in a later turn. What you dismissed was remembered as a file name, with no memory of which round of changes it was; now it is remembered as that round's diff, so a file whose changes have since moved shows up again.
- The `@14@` that sometimes appeared at the end of a reply is gone. It is not a rendering bug — it is the message id the `@tarquinen/opencode-dcp` plugin tags every conversation message with, which the model sometimes echoes back. The transcript now drops such a tag when it stands alone on the last line, and leaves the ones in the middle alone, where they are a real reference to another message.

- A settings panel. The gear button in the chat header — next to the history button — opens an editor tab that edits two things side by side: the extension's own settings, and the opencode server's configuration (`opencode.json`). The server's own config was reachable only by hand-editing the file; it is now a list of rows, one per key, with the scope switchable between the global file and the project's.
- The panel writes the server's config file the way the server does, with `jsonc-parser`, so the comments and formatting in a hand-written `opencode.json` survive an edit made from VS Code.
- New settings: `opencode.notifications.turnComplete` (default on), `opencode.notifications.permissionRequest` (default on) and `opencode.notifications.errors` (default off). A notification is only raised when nobody is looking at the chat — a turn that finishes, a permission request that blocks the turn, or an error.

The transcript was restyled after comparing three shipping agents — opencode desktop, Command Code (Claude Code) and the terminal TUI. A prototype with four variants was built and reviewed; the Command Code style won.

- Your messages are now a filled bubble on the right instead of a right-hand rule. The old rule also right-aligned the contents, so pasted code blocks and lists came out right-aligned too; inside the bubble everything is left-aligned again.
- Tool calls are one line: a small icon, a verb (`Ran command`, `Read`, `Searched`), the target in monospace, and a chevron that expands the output in place. A failed tool shows the reason the server sent (`ToolState.Error.error.message`), which used to be dropped.
- Thinking is its own row — "Thought for 4 seconds", taken from the reasoning part's timing — and expands to the reasoning text.
- Markdown typography was rebuilt: 13.5px body at 1.72 line height, a real heading hierarchy, inline code as a small chip, code blocks without borders but with a language label and a copy button, and tables that scroll inside their own frame instead of widening the panel. The streaming caret now rides the last line of the reply.
- The per-message cost line is gone; the session cost is already in the context strip below the composer.
- What a message points at is now legible. Attachments used to be one `📄 name` chip each, so a pasted image, a selected range of lines and a plain file all looked alike, and a selected range lost its line numbers. A sent message now keeps the bubble for its text and shows its attachments underneath, collapsed into one line (`附件 3 · CHANGELOG.md · screenshot.png`), expanding into a row per attachment: images get their own thumbnail, a selection shows its line range, and a file opens in the editor.
- A link attached to a message used to arrive as a bare `参考链接: https://…` line inside the text. It is now pulled back out of the message and shown as an attachment row of its own that opens in the browser, so an attached link no longer reads like something you typed.
- Fix: clicking an attachment did nothing for a pasted image, and a selected range opened without its lines. A pasted image now opens a preview of the image itself (it exists only as base64 inside the message, so there is no file to open), a link opens in the browser, and a selection opens the file with those lines selected.

## 0.4.2

- Fixed: streamed replies could duplicate, reorder or lose text. A reply shaped `text → tool → text` was merged into the message's last text part using a length comparison that spanned different paragraphs, so the second paragraph could appear above the tool card, replace the first one, or both. Text and reasoning are now addressed by the ordinal the server sends with each event, and a part is never overwritten from a different part's buffer.
- The server's `session.message.content.updated` event — the message's full content array — is now used as the authoritative content. Live state is dropped once the server marks a message finished, and it is cleared at turn end instead of living until the session switched.
- Streaming is coalesced: the host posts at most one delta per 60ms window, and the webview folds deltas into a single dispatch per animation frame. Long replies no longer re-parse the whole message once per token.
- Markdown links in replies and user messages now open in the browser (they were inert inside the webview). Stored attachment chips open the file when the attachment carries a `file:` URI.
- The transcript keeps following the bottom while content grows for reasons React state cannot see (an expanded card, a late image, a font reflow).
- Tool failures now carry the server's error message on the part type, ready for the tool card rework.

## 0.4.1

- Fix: choosing a model or agent on an empty "New session" panel produced a 404 from `/api/session//model` — no server session existed yet, so the request had an empty id. Choices are now kept locally and sent in the body of the lazily created session. Session-scoped client methods also reject an empty id instead of emitting a malformed URL, and abort/compact no longer fire without a session.
- Messages sent while the model is working are now queued instead of being dropped. The queue is a collapsed `QUEUE n` header above the composer; expanding it shows each message with force-send (interrupts the current turn) and delete. Queued messages send automatically when the turn ends; a failed or stopped turn holds the queue until resumed.
- Fix: the send button always showed the square "stop" icon, even when idle. It is now a single up-arrow button in both states; Esc stops the running turn.
- The empty-state welcome screen is now a single terminal-style prompt line (`› What should we work on?`) with the version below it. The logo and the clickable prompt suggestions are gone.
- The composer input, its pickers and every dropdown opened from it now use the monospace font of the welcome screen. The send button is blue instead of following the theme's button color.
- A context strip under the composer shows the current git branch (`*` when the working tree is dirty) and the workspace path on the left, with context tokens used and the session cost on the right.
- Fix: the context strip said "no git" inside git repositories. The branch is now read from `.git/HEAD` directly (with the built-in git extension as the source for the dirty marker), and the details are logged to the "OpenCode" output channel.
- The header mark is now a rounded badge holding the OpenCode glyph, centred with the session title on a tighter line box.
- Fix: the composer input showed scrollbar arrows on Windows. The scrollbar is hidden and the auto-resize now accounts for the textarea padding.
- Model picker: the favourite star is gone from the effort row, and per-row family icons are gone too — rows show name, provider and the cost/effort hint only. The narrow-panel ladder loses its icon step, so the model button goes straight from the short name to hidden.
- The action bar (mode, model, reasoning effort) now renders in one commit once the catalog arrives, instead of popping in picker by picker as each one's data landed.
- The first paint now waits for the host's initial snapshot: the panel used to show a half-built header, welcome and composer that then filled in piece by piece (title, context strip, pickers). Connection errors still render immediately so the retry banner is visible.
- Session history rows gained a leading status dot that only lights up for live work: green while the model is working, yellow when the session is blocked on a permission reply, red when its last turn failed or was interrupted. Idle, successful and never-run sessions show no colour. States are read when the menu opens, from the session list (`time.busy`/`time.idle` and `outcome`), `/api/session/active` plus the pending permission requests.

## 0.4.0

- History picker moved into the webview: the header clock button now opens a date-grouped menu anchored to the button (rename / fork / export / delete actions on hover), instead of the window-centered QuickPick. The command-palette entry keeps the QuickPick.
- Send button is circular (26px) and height-aligned with the effort picker row.
- Shared session grouping helper (src/util/sessions.ts).

## 0.3.9

- Header buttons fully unified: same 26px box, 16px SVG icons (clock and plus), no lingering focus background — heights match the session title row.

## 0.3.8

- Header: OpenCode outline mark beside the session title; history/new-session buttons on a shared 26px box.
- Send button aligned with the picker row height (26px); processing state shows a rounded square icon matching the arrow size.
- Welcome screen redesigned: larger outline logo, tagline and three one-click prompt suggestion cards (click fills the composer).

## 0.3.7

- View title shortened to just "OpenCode".
- Header history/new-session buttons aligned to a shared 26px box.
- Welcome screen redesigned: larger outline logo (88px), bigger title/tagline, balanced spacing.

## 0.3.6

- New-session mode button always shows Build instead of a placeholder while the agent catalog is still loading.
- Welcome screen simplified back to logo + tagline + version.

## 0.3.5

- Fixed: agent/mode picker could stay empty (only Build) — the server loads its agent registry asynchronously after /api/info becomes ready, so the first catalog fetch raced and returned []. The extension now reloads the catalog on agent/provider/model/config registry events and retries briefly when a fetch comes back empty (verified: 0 → 7 agents).
- Reasoning-effort picker is always visible (no hover requirement).

## 0.3.4

- Selected agent/effort rows no longer render in focus-border blue — they use the same bold treatment as the selected model row.
- Agents catalog load now logs its count to the output channel for diagnosing picker issues.

## 0.3.3

- Slash-command and mention lists now scroll the keyboard-highlighted row into view.
- Reasoning-effort picker shows "Default" instead of a placeholder when the session's variant does not exist on the newly selected model; styling matches the model picker with content-sized width.

## 0.3.2

- Marketplace icon: center block switched to light gray (#CFCECD, the official ornate-light gray) so the nested-frame mark reads white frame / light-gray block on the white tile.
- Activity-bar and welcome marks redrawn in outline style (stroked frame + hollow center block) to match neighboring editor icons.

## 0.3.1

- Fixed: agent picker was stuck on a single "build" entry — opencode 2.3.0's `/api/agent` (and the other location-scoped catalog endpoints) only return data for the deepObject query `?location[directory]=…`; the plain `?directory=` form returns empty lists (verified live). Fallback labels are capitalized (Build/Plan).
- Composer action bar restyled: dropdowns are borderless/transparent with hover highlight, and their width grows with the model name instead of truncating.
- Menu item styling unified across the agent / model / effort pickers.
- `@` mention list no longer shows icons, matching the `/` command list style.

## 0.3.0

Composer reworked to mirror the opencode desktop input:

- Slash commands: typing `/` opens a command picker (server commands + built-ins with keyboard navigation); `/new`, `/undo`, `/compact`, `/fork`, `/export` run client-side, the rest execute on the server.
- `@` mentions now combine skills and workspace files (skills first); selecting a skill inserts a mention.
- Model picker rebuilt: search box, Recent → OpenCode Go → OpenCode → other provider sections, `免费` badge for free models, hover flyout with reasoning-effort variants (Default/High/…), Favorite toggle and model meta (provider · context · tools).
- Reasoning-effort picker only appears while hovering the composer.
- Send button is a desktop-style up-arrow; placeholder text updated.
- Marketplace icon switched to the desktop-style light variant (white rounded tile, near-black mark) generated by `scripts/generate-icons.mjs`.

## 0.2.2

- Marketplace icon regenerated with the official OpenCode mark (dark tile, white frame, gray block) via a dependency-free PNG generator (`scripts/generate-icons.mjs`); activity + welcome marks share the exact official geometry.
- Sessions tree view removed — a clock button in the chat header opens a date-grouped history picker with per-session rename / fork / export / delete actions.
- Fixed: user bubbles rendered an extra empty line (invisible rewind button occupied a row; it is absolutely positioned now).
- Fixed: agent picker could be empty on opencode ≥ 2.3.0 — catalog endpoints are location-scoped and now receive the workspace `directory` (verified live: `/api/agent` returns `[]` without it). The picker is always rendered while connected, and catalog sources load independently.
- Custom styled dropdowns replace native selects for agent / model / effort.
- Welcome screen now shows usage tips (mention files, paste images, Shift+Tab agent cycling, message rewind).

## 0.2.1

- Fixed: chat message order — the v2 message list arrives newest-first and was rendered as-is, putting your message below the reply.
- Fixed: sent messages now appear instantly (optimistic local bubble) instead of after the server round-trip.
- Mode (agent), model and reasoning-effort pickers moved into the composer action bar below the input; wider model selector with ellipsis for long names.
- Sessions tree groups start collapsed — expand a group to pick a session.
- OpenCode mark geometry aligned with the official favicon and enlarged (activity/container icon + welcome logo share the same shape).

## 0.2.0

- opencode v1 detection: servers reporting a v1 `/global/health` fail startup immediately with an `opencode upgrade` guidance message instead of a generic connection failure.
- Image attachments: paste or drag up to 6 images per message.
- Session fork and Markdown transcript export (sessions tree context menu).
- Message-level rewind (removes later messages, reverts their file changes).
- Reasoning-effort selector for models exposing variants (low/medium/high/…).
- Version guard: non-blocking warning when the server major version differs from the tested v2 range.
- UI moved fully to the secondary sidebar (no activity bar container).
- Marketplace icon and OpenCode-branded marks.
- Fixed: spawning `.cmd` shims on Windows (Node CVE-2024-27980 requires a shell).

## 0.1.0

Initial release.

- Chat webview view (secondary sidebar by default, movable between views and editor tabs) with streaming replies, markdown rendering, collapsible reasoning and tool cards.
- Sessions tree with date grouping, open / rename / delete.
- Native VS Code diff editors for file changes, with per-file Keep / Revert.
- Inline permission cards (Allow once / Always allow / Deny) backed by the opencode permission API.
- Model picker (all configured providers, including OpenCode Go subscription models) and native agent modes (build / plan / custom), Shift+Tab to cycle.
- `@` file mention with fuzzy search, "+" multi-file attach, auto-attach of the active editor selection.
- Automatic `opencode serve` lifecycle per window (random port, random password) or connection to an external server via settings.
- Plan-mode handoff: "Proceed with the plan in build mode".
- Works on Windows, Linux and WSL/SSH remote workspaces (the extension runs in the workspace host).
