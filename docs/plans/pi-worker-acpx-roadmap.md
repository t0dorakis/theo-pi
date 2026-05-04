# Pi Worker ACPX Roadmap

Status: current follow-up roadmap after `feat/acpx-backend`.

## Shipped baseline

- ACPX runtime adapter is the only execution path for pi-worker jobs.
- Queue owns job lifecycle; result/request/event files are artifacts.
- Persistent ACP sessions are keyed by worker agent and chat id.
- Per-session turn locks serialize same-chat turns while allowing different chats to run concurrently.
- Job timeout/cancel uses `AbortController`, runtime `turn.cancel()`, and cancel markers.
- Structured ACPX events are persisted per job under `~/.pi-worker/jobs/events/<jobId>.ndjson`.
- Gateway rejects numeric chat ids for non-Telegram jobs and exposes job status/events/cancel/reset endpoints.
- VM dogfood adapter exposes pi-worker as an ACP-compatible stdio agent through `scripts/vm/pi-worker-acp`.

Canonical references:

- `docs/architecture.md`
- `docs/CONTEXT.md`
- `docs/glossary.md`
- `docs/adr/0001-acpx-sole-execution-runtime.md`
- `docs/adr/0002-queue-is-lifecycle-authority.md`
- `docs/adr/0003-persistent-acp-session-keys-and-file-locks.md`
- `docs/adr/0004-chat-id-routes-delivery.md`
- `docs/adr/0005-per-session-turn-lock-policy.md`

## Future work

### 1. Telegram live event streaming

Use persisted/live ACPX events to stream useful progress to Telegram:

- output chunks
- thought/status snippets, rate limited
- tool call start/update/finish summaries
- final answer delivery

Keep final queue/result state authoritative; streaming must be best-effort.

### 2. Event polling scalability

Current gateway polling rereads the full NDJSON event log per `/jobs/<id>/events?after=N` request. Replace with one of:

- byte-offset cursor
- line-offset cursor
- SSE/push stream from gateway
- compact in-memory tail cache backed by file replay

Preserve monotonic cursor behavior across runner restarts.

### 3. ACP tool-call normalization

ACP dogfood currently forwards text chunks only. Before enabling tool events, normalize ACPX incremental tool events into valid ACP `tool_call` / `tool_call_update` pairs with stable ids and complete fields.

### 4. Attachments

Evaluate Telegram file/image inputs and map them to ACPX/ACP attachments only after text runtime is stable.

### 5. Flow/run bundles

Flow/run bundle support remains useful for explicit multi-step workflows, audit trails, and checkpoint gates. Do not replace simple single-turn queue jobs until a concrete flow use case exists.

### 6. Bun-native daemon

Replace remaining tmux process management with a small Bun daemon. Systemd/launchd can remain optional outer wrappers.

## Non-goals

- Reintroducing smolvm or tmux as execution backends.
- Custom VM delegation protocols outside official ACP.
- Storing large generated implementation/review transcripts in `docs/plans`.
