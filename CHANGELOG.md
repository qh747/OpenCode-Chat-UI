# Changelog

## 0.4.18

- The README's screenshot is now actually shipped. The image reference (`images/panel-locations.png`) existed in both READMEs since 0.4.15, but the file itself was never committed, so the link was broken everywhere. The real screenshot (panel open in an editor tab beside the welcome screen) is now in the repository and packaged — `.vscodeignore` does not exclude `images/`, so the Marketplace listing renders it on the next publish.

- The question card now appears live. The server's `form.created` event (captured verbatim from a v2.3.0 server) carries the owning session only inside `data.form.sessionID` — the top-level `data.sessionID` the panel keyed on does not exist, so the live event was silently discarded and the card surfaced only after a session switch forced a resync. Session ownership now falls back to the nested form object; `form.replied`/`form.cancelled` (which do carry the top-level id + sessionID) are unchanged. Covered by a unit test against the exact captured payload shape.
- Question options are letter-prefixed (`A.` `B.` `C.` …) so answers can be referred to by letter.

- While a turn is running, the composer's send button becomes a red stop button with a centered square (same spot, same size) — one click interrupts the turn, `Esc` still works. Typing stays open the whole time: queued follow-ups are entered as usual and sent with the configured send key (`Enter` by default); the send button itself no longer queues. A small "n queued" hint shows next to the pickers while messages are waiting. (Validated in `prototype/send-stop`, variant A.)
- The diff list's keep/revert buttons are demoted to secondary style — no fill, hairline border, muted text (revert in red) — so they stop competing with the file names.
- README gained a screenshot showing the panel open in an editor tab beside the welcome screen.

- Fixed an uncaught error in the extension's runtime state (`repo.onDidChange is not a function`). Some environments hand the built-in git extension's repository object over without its `onDidChange` event; the provider now degrades to a one-shot status read instead of throwing, guards against a repository `state` shape it does not recognize, and wraps the whole connection attempt so no git-API surprise can ever surface as an uncaught error again. Covered by a new unit test that drives the real provider against a stubbed git API reproducing the exact failure.

- Session isolation extended to every surface that survived a switch: error banners, the session-info panel's timestamps/cost, and async attachment responses (`@` file search results, the file-picker's picks, pasted/dropped images) all belonged to the previous session's state. Async responses are now stamped with the session that was open when the request was made — a file picker or image paste answered after a switch is dropped instead of dropping its chips into the new session's composer, and each snapshot clears the previous session's transient state. The composer's own draft/attachment scoping above was verified against a real-DOM test and is included.

- The model's `question` tool no longer deadlocks the turn. The tool parks a pending form on the server (`form.created` event) and waits for the client to answer — the panel had no form support at all, so the turn sat on a bare "question" tool row forever. Pending forms now surface as an interactive question card above the composer (choice buttons, multi-select, free-text answers, submit/dismiss), the answer is sent via `POST /api/session/{id}/form/{formID}/reply` (string fields answer with a plain string, multi-select with an array — verified live on v2.3.0), and dismissing tells the model to continue without answers. Forms ride the same authoritative polling backstop as permissions, since the event stream is lossy.
- The composer's draft and attachments are scoped to their session. Both were component-local state in a component that stays mounted across session switches, so session A's text and file chips appeared in session B. Switching now files the outgoing draft under its own session and restores the incoming session's; the pre-session draft survives session creation.
- Queuing a message while the model works auto-expands the queue strip, so the hand-off is visible instead of a silent count bump. Switching sessions (or out to a subagent and back) collapses it again — the expansion belongs to the moment, not to the conversation.
- The fold carets got real hit areas: the session-history submenu triangle grows to a 20px-wide, full-row-height target, and the transcript's tool/thinking/attachment fold rows gained a bit of height instead of their previous 1px padding.

## 0.4.11

- The context strip no longer disappears before a session's first turn. The usage segment was keyed on a billed assistant message, and a fresh session has none, so the strip fell back to just the branch and the path until the first reply finished. It now reads `0 / 1.0M | —` from the active model's context window — 0 tokens used, cache hit rate still unknown — and switches to the real figures as the turn ends.
- Subagents are visible while they run. A turn that hands work to a subagent (the `task` tool) showed nothing but the composer's status line: no sign that a subagent existed, let alone a way to stop one. While a turn is running the host polls the server's job listing for the session's descendants and a strip above the composer lists each running subagent with its agent, its description and how long it has been going. Each row has a Stop button that interrupts only that subagent's child session, so the parent turn keeps working.

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
