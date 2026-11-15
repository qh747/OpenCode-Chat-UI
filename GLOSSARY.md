# Glossary

Canonical terms for the OpenCode for VS Code extension. Terms are domain concepts, not implementation details.

## Chat domain

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

**Part**
One ordered block inside an assistant reply: a passage of text, a passage of reasoning, or a tool call. Tool calls carry an identity of their own; text and reasoning parts are known by their position within the reply.

**Queued message**
A user message sent while the model is still working. The host holds it in FIFO order and sends it when the turn ends; it can be deleted or force-sent (interrupting the current turn). A failed or stopped turn holds the queue until it is resumed.

**Rewind point**
A user message used as the boundary for a revert: everything after it (messages and their file changes) is rolled back via the server's staged revert.

## Integration surface

**opencode server**
The `opencode serve` HTTP process (v2 API) that the extension talks to. Spawned privately per window or connected externally.

**Catalog**
The server-provided lists of agents, models and the default model ref. Loaded once per connection and after agent/provider update events.

**Snapshot**
The authoritative UI state the host sends to a webview surface: current session, messages, pending permissions, diffs and catalog.

**Event stream**
The server's volatile SSE feed (`/api/event`). Lossy by design; consumers resync authoritative state on reconnect instead of trusting it alone.

**Sink**
A webview surface (sidebar view or editor tab) attached to the shared controller. All sinks receive identical broadcasts.

**Slash command**
A `/`-prefixed command typed in the composer. Server/config commands (from `/api/command`) execute on the server; built-in client commands (`/new`, `/undo`, `/compact`, `/fork`, `/export`) are handled by the extension.

**Skill**
A named capability from the opencode server's skill list, mentioned in a message as `@<skill-name>` to steer the agent.

**Attachment**
Something the user points a message at: a workspace file, a selection inside one, a pasted image, or a link. Files and images travel to the server as attachments; a link travels inside the message text, because the prompt API has no attachment form for it.

**Attachment chip**
The token in the composer that holds an attachment before the message is sent. A workspace file, the active editor selection, a staged pasted image, or a link.

**Reference link**
A link the user attached to a message. It reaches the server inside the message text, marked so the transcript can show it as an attachment rather than as prose.

**Recent models**
The extension's local, per-workspace list of the last five model refs used — shown as the first section of the model picker.

**Local preference**
A setting the extension keeps for itself, stored in the VS Code configuration under the `opencode.*` prefix and edited on the native VS Code settings page. It belongs to this extension and travels with the editor, not with the opencode server.

**Server config**
A setting the opencode server reads from its own configuration file. The extension edits that file on the user's behalf, but the server owns the value and decides what an absent key means.

**Explicit value**
The value actually written in a config file, as opposed to the value the server falls back to when the key is absent. The panel shows the explicit value and names the fallback, so an unset row is never mistaken for a set one.

**Server config panel**
The editor tab where the opencode server's configuration is edited; every row writes into the server's config file. The extension's own preferences do not appear here — their surface is the native VS Code settings page.
