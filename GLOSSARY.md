# Glossary

Canonical terms for the OpenCode Side Panel extension. Terms are domain concepts, not implementation details.

## Chat domain

**Transcript**
The readable conversation record the chat panel renders: one row per user prompt and assistant reply, chronological, with tool calls and attachments folded into their messages. Its history loads progressively: a session opens on the newest page and older pages arrive as the reader reaches the top. Distinct from the session info panel's raw message list, which renders the same loaded state unread.

**Load-earlier**
Backfilling the transcript's older messages on demand as the reader reaches the top. What has been backfilled is append-only: a refresh or a turn end never drops loaded history, and prepending a page keeps the reader's place stable. The history closes only when the server says the beginning is reached. Distinct from export, which always covers the whole session in one pass.

**Session**
One conversation thread with the agent, scoped to a project directory. Identified by a server-assigned ID; has a title, cost, token usage and timestamps. Created lazily on first message or explicitly via "New Session".

**Agent**
A server-side persona that determines what the model may do — `build` (full tool access), `plan` (read-only), `ask`, plus user-defined agents from opencode config. Selection is per-session and enforced server-side; the extension only switches and displays it.

**Model ref**
A triple identifying what runs the turn: provider ID + model ID + optional variant (reasoning effort such as `low`/`high`). All three come from the server's catalog.

**Variant**
A reasoning-effort preset attached to a model. Absent means the model's default behavior.

**Permission request**
A server-issued question (e.g. "run this command?") that blocks the agent loop until replied with `once`, `always` or `reject`. Rendered as an inline card in the chat.

**Turn**
One user prompt plus everything the agent produces until the session goes idle. File changes within a turn surface as diffs.

**Cache hit rate**
The share of a turn's prompt tokens that the provider served from its prompt cache rather than re-processing. Reported per assistant reply; a high rate means the ongoing conversation is reusing cached context.

**Diff list**
The collapsed-by-default strip listing the files this session's agent changes are still pending on: one quiet count row that expands into one row per file with a Revert action. The rows are filtered to the session's attribution set; an empty attribution set shows an empty list. A row the user has processed stays hidden by its processed signature until the file's changes change again, and an added row whose file is absent from disk is never shown — nothing is pending on it. Distinct from a file's diff view, which shows the actual edits.

**Processed signature**
The user's decision that one round of a file's changes is handled, recorded at Revert time as the file plus its change signature (status plus additions plus deletions). Kept per session; it hides the row across refreshes, session switches and new turns. The row returns only when the file's changes change again — a new signature is news, an old one is not. Distinct from Revert's disk effect, which the server's message history never sees.

**Attribution set**
The union of the files a session's own assistant snapshots list — the only per-session file attribution the server exposes — counting only messages that made tool calls: a message's snapshot lists whatever changed in the shared working tree inside its own snapshot window, so a message that called no tool (a pure chat turn) has nothing of its own to claim, and the changes its window framed are treated as foreign. The diff list is filtered to the set; an empty attribution set yields an empty diff list, never another session's changes.

**Part**
One ordered block inside an assistant reply: a passage of text, a passage of reasoning, or a tool call. Tool calls carry an identity of their own; text and reasoning parts are known by their position within the reply.

**Queued message**
A user message sent while the model is still working. The host holds it in FIFO order and sends it when the turn ends — to the session it was typed in, even if the user is elsewhere; delivery follows the owning session, not the one on screen. It can be deleted or force-sent (interrupting the current turn). A failed or stopped turn holds the queue, for its own session, until it is resumed.

**Subagent job**
A subagent, reported by the server's job listing for a session and its descendants. Jobs of kind `subagent` that are running or failed are shown: one row with the agent, its description and the elapsed time; the row itself opens the child session in the chat (the same session switch the history menu performs). Running rows carry a Stop action that interrupts the child session; failed rows keep none (nothing left to stop) and stay pinned for 30s after the server's list drops them. A running job whose child session has a pending permission reply is shown blocked (yellow). The listing has no events, so the host polls it. Distinct from an agent in the catalog, which is a definition, not a running job.

**Parent session**
The session a session was spawned from, identified by the server's `parentID`. A session without one is a root session. The chat panel's back button (shown while a child session is on screen) returns to the parent session, one level up; nesting means walking to the root one step at a time. Distinct from the root session, which is the top of the parent chain, not necessarily the previous one viewed.

**Row status**
A history row's status is the status of the session on that row alone: blocked (yellow, waiting on the user), working (green), failed (red), idle (uncolored). Subagent sessions never appear in the history menu, and their states never paint a root row — a delegating session reads uncolored while its subagent works. Delegation activity lives in the chat's subagent strip instead. Pinned by ADR-0016, which supersedes the aggregated rule of ADR-0010.

**Rewind point**
A user message used as the boundary for a revert: everything after it (messages and their file changes) is rolled back via the server's staged revert.

**Trigger tail**
The caret-prefix tail match that opens a completion menu: an `@` followed by a space-free run up to the caret opens the file mentions, a `/` (any caret position) opens the command/skill list. When both fire, the trigger typed later loses to an already-active `@` tail. A space always kills the tail; the trade-off is that slashes inside URLs and paths also fire the `/` menu.

**Enter decision**
The composer's Enter behaviour: a completion menu with a highlighted row is accepted at the caret (splicing the trigger region in place, surrounding text kept) wherever the caret is; a bare Enter in mid-text does nothing; only caret-at-end Enter sends or runs a command. Pinned by ADR-0015.

**Boot layer**
The panel's first-paint state: the panel renders from frame one but stays dimmed and inert behind a thin indeterminate progress bar until ready — connected, first snapshot applied, and the catalog's model list resolvable. A 10s timeout releases it regardless; a connection error bypasses it straight to the banner.

## Integration surface

**opencode server**
The `opencode serve` HTTP process (v2 API) that the extension talks to. Spawned privately per window or connected externally.

**Catalog**
The server-provided lists of agents, models and the default model ref. Loaded once per connection and after agent/provider update events.

**Snapshot**
The authoritative UI state the host sends to a webview surface: current session, messages, pending permissions, diffs, running subagent jobs and catalog.

**Session stamp**
The session ID the webview attaches to an action message, naming the session the user was looking at when they made it. The host drops stamped actions whose session it no longer hosts, so a click on a stale surface cannot land in the incoming session.

**Split-brain window**
The interval during a session switch in which the host has already flipped to the incoming session while the webview still renders the outgoing one. Closed from the UI side by posting a snapshot immediately after the host's synchronous clears, and defended in protocol by session stamps.

**Session-bound state**
The rule that per-session state — the diff list, the message queue, subagent jobs — belongs to its session, not to the session currently displayed. Memory, delivery and visibility follow the owning session: A's queued messages go to A even while B is on screen, A's processed rows stay hidden when the user returns to A, and A's running jobs never leak into B's strip. Display is a viewport, never an owner.

**Event stream**
The server's volatile SSE feed (`/api/event`). Lossy by design; consumers resync authoritative state on reconnect instead of trusting it alone.

**Message pagination**
The server's message listing is cursor-paginated: one page carries the newest messages in a chosen order and is never the whole history, and a consumer follows the returned cursor to keep walking the timeline. The cursor travels alone — a request that pairs it with an ordering choice is rejected. A listing without a cursor is a window, not the record.

**Sink**
A webview surface (sidebar view or editor tab) attached to the shared controller. All sinks receive identical broadcasts.

**Slash command**
A `/`-prefixed command typed in the composer, matched against server/config commands (from `/api/command`), built-in client commands (`/new`, `/undo`, `/compact`, `/fork`, `/export`), and the skill list. Commands execute server- or client-side; matching a skill id inserts (or sends) a `@<skill-id>` mention instead of running a command.

**Skill**
A named capability from the opencode server's skill list, loaded by the agent's `skill` tool or by a mention in the user's message. A mention always spells the skill's id (`@<skill-id>`); the display name is for the picker UI only, since it can differ from the id. Skills are surfaced and selected from the slash-command picker.

**Attachment**
Something the user points a message at: a workspace file, a selection inside one, a pasted image, or a link. Files and images travel to the server as attachments; a link travels inside the message text, because the prompt API has no attachment form for it.

**Attachment chip**
The token in the composer that holds an attachment before the message is sent. A workspace file, the active editor selection, a staged pasted image, or a link.

**Reference link**
A link the user attached to a message. It reaches the server inside the message text, marked so the transcript can show it as an attachment rather than as prose.

**Recent models**
The extension's local, per-workspace list of the last five model refs used — shown as the first section of the model picker.

**Session info panel**
The slide-over opened from the context strip's usage figure. It mirrors the desktop's session view: the stat grid for the current session, the system prompt, and the raw message list, all read from the state the chat already holds. Distinct from the transcript, which renders the conversation readably rather than raw.

**Workspace folder**
The VS Code folder the panel binds to (`workspaceFolders[0]`): the opencode server's working directory and the repository the context strip falls back to. One per window; the extension has no multi-root awareness. Distinct from where the agent may actually be working — a session or a worktree of the same repository.

**Session directory**
The directory a session is anchored to on the server (its location); the agent's tools run there. Sessions are created at the workspace folder, and the extension never moves one, but opencode's worktree feature can. Every event a session emits is tagged with its directory, which is how the panel tells a moved session apart.

**Active worktree**
A git worktree of the workspace repository whose branch the context strip currently follows: the most recent branch-update signal among the session's directory, the repo's worktrees, and the workspace folder itself. The user's editor still points at the workspace folder — only the strip's branch segment follows the worktree, with its full path in the tooltip.

**Local preference**
A setting the extension keeps for itself, stored in the VS Code configuration under the `opencode.*` prefix and edited on the native VS Code settings page. It belongs to this extension and travels with the editor, not with the opencode server.

**Server config**
A setting the opencode server reads from its own configuration file. The extension edits that file on the user's behalf, but the server owns the value and decides what an absent key means.

**Explicit value**
The value actually written in a config file, as opposed to the value the server falls back to when the key is absent. The panel shows the explicit value and names the fallback, so an unset row is never mistaken for a set one.

**Server config panel**
The editor tab where the opencode server's configuration is edited; every row writes into the server's config file. The extension's own preferences do not appear here — their surface is the native VS Code settings page.
