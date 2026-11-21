# ADR-0007: Read running subagents from the job listing, stop one by interrupting its child session

- Status: accepted
- Date: 2026-11-16

## Context

A turn can hand work to a subagent: the model calls the `task` tool, the server
starts a child session, and the parent turn waits for it. The panel had no way
to show that, so during a delegation the UI showed only the composer's
"working" line — no name, no elapsed time, no way to stop the thing. The only
trace of a subagent in the event stream is the `task` tool part, which carries
its input and its output but not the child session it created.

The server (verified live on 2.3.0) exposes:

- `GET /api/experimental/job?sessionID=<id>&descendants=true`, returning one
  record per background job with `kind` (`subagent` | `shell` | `image`),
  `status` (`running` | `completed` | `error` | `cancelled`), `time.started`,
  and, for subagents, `childSessionID`, `agent`, `title` and `description`.
- `POST /api/session/<childSessionID>/interrupt`, which answers
  `{ "interrupted": true }` and makes the job leave the listing within a second.

It exposes no job events: the event type enumeration has no `job.*`. And
`POST /api/session/<id>/background` is not a stop — it turns a foreground tool
call into a background one, i.e. it detaches a job rather than ending it.

## Decision

1. While a turn is running, poll the job listing for the current session with
   `descendants=true` every 2 seconds; stop polling when the turn ends.
2. Show only jobs that are `kind === "subagent"` **and** still `running`, mapped
   to the UI's own shape (`childSessionID`, `agent`, `description`, `started`)
   by one pure function. Shell and image jobs belong to the session, not to a
   delegation, and are not part of this strip.
3. Stop a subagent by interrupting **its child session** (`childSessionID`), not
   the parent session. The parent turn then sees the `task` tool fail and
   continues — stopping a delegated job must not kill the conversation.
4. Carry the rows inside the snapshot and over a `subagents` message so a
   reconnect, a session switch or a turn boundary clears them without a
   separate reconciliation path.

## Alternatives rejected

- **Derive subagents from `task` tool parts in the transcript.** No extra
  request, but the part carries no child session id, so the Stop action has
  nothing to interrupt; and the part's presence does not say whether the job is
  still running.
- **Watch child-session events instead.** The event stream does carry
  `session.*` events for child sessions, but they are not attributed to the
  parent job, and a subagent that has started no event yet would be invisible.
- **Interrupt the parent session.** Stops the whole turn, which is what the
  existing Stop button already does; it does not answer "stop that one
  subagent".
- **Call `/background`.** Changes who owns the job, not whether it runs.
- **Poll from the webview.** The webview has no credential for the server and
  no knowledge of the session lifecycle; the host already owns both.

## Consequences

- A running subagent is visible within one poll interval, with its agent, its
  description and the elapsed time ticking every second in the webview.
- The listing is an `experimental` endpoint. If it moves, one method in the
  client (`jobs()`) and its route test change; the UI shape does not.
- Polling is per running session: 2s intervals, two extra requests per 2s while
  a turn delegates. It stops the moment the turn ends, so an idle window makes
  no requests.
- Elapsed time is derived from `time.started` against the webview clock; a
  clock skew between host and webview shows in the seconds, not in the state.

## Revision (2026-11-21): subagent views do not poll

The core decision stands: the job listing is the subagent strip's only data
source, and stopping one job means interrupting its child session. The
opencode-sidebar change (`.scratch/opencode-sidebar/`) narrows decision 1:
while the session on screen is itself a subagent session, the strip is never
rendered there, so the host neither polls the listing for it nor starts a
timer — `refreshSubagents` and `startSubagentPolling` early-return, and
`refreshDiffs` skips the diff pull for the same reason. Polling resumes for a
root session through the existing switch → clear → resync flow, so decision 1
now reads "poll the job listing for the current session **when that session is
a root session**".
