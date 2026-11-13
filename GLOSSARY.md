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

**Attachment chip**
A context item the user attaches to a message: a workspace file, the active editor selection, or a staged pasted image.
