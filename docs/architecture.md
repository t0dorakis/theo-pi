# Pi Worker Architecture

Current architecture for the Pi worker on `feat/acpx-backend`. For domain language, see [`docs/CONTEXT.md`](./CONTEXT.md) and [`docs/glossary.md`](./glossary.md).

## Topology

```text
macOS host / OrbStack VM / local smoke test
  |
  | optional operator plane
  | - pi-worker-supervisor (still tmux-aware)
  | - start/status/restart/stop/checkpoint/tail-logs wrappers
  | - future replacement target: Bun-native daemon, optionally wrapped by systemd/launchd
  |
  v
execution plane
  |
  +-- HTTP gateway: scripts/vm/pi-worker-gateway.ts
  |     - /run enqueues non-Telegram jobs
  |     - /health includes worker status + ACPX health
  |     - /reset closes inner ACP sessions and writes cancel markers
  |     - /jobs/<id>/events exposes event-log records for ACP adapter polling
  |     - /jobs/<id>/cancel writes cross-process cancel markers
  |
  +-- Telegram bot: scripts/vm/pi-worker-telegram-bot.ts
  |     - commands enqueue numeric-chat jobs
  |     - delivers completed numeric-chat jobs
  |
  +-- ACP stdio adapter: scripts/vm/pi-worker-acp-stdio.ts
  |     - speaks official ACP over stdin/stdout via @agentclientprotocol/sdk
  |     - lets acpx spawn the worker with --agent
  |     - maps outer ACP sessions to non-numeric acp-* chat IDs
  |
  +-- CLI: scripts/vm/pi-worker-submit-job.ts / pi-worker-run-job.ts
        - submit creates queue records
        - run claims one job and executes it

queue + result channel
  |
  +-- queue: ~/.pi-worker/telegram/jobs/<jobId>.json
  |     - authoritative lifecycle: pending -> running -> done | failed
  |
  +-- artifacts: ~/.pi-worker/jobs/{requests,results,events,cancels,leases}/
        - request/result snapshots
        - ACPX event logs
        - cross-process cancel markers
        - leases

ACPX runtime adapter
  |
  +-- scripts/vm/lib/acpx/runtime-adapter.ts
        - creates/uses AcpxRuntime
        - oneshot mode: session key = jobId
        - persistent mode: session key = `${agent}-${chatId}`
        - streams ACPX events to NDJSON
        - writes result-channel artifacts
```

## Runtime state layout

```text
~/.pi-worker/
├── state.json
├── heartbeat.json
├── health.json
├── bootstrap-version
├── supervisor.log
├── sessions/
│   ├── <workerName>.json
│   ├── <workerName>.stop
│   └── <workerName>.supervisor.pid
├── checkpoints/
│   ├── latest.json
│   └── <label>-<timestamp>.json
├── session-locks/
├── acp/
│   └── sessions/
├── telegram/
│   └── jobs/
│       └── <jobId>.json
└── jobs/
    ├── requests/<jobId>.json
    ├── results/<jobId>.json
    ├── events/<jobId>.ndjson
    ├── cancels/<jobId>.cancel
    ├── leases/
    └── runner.log
```

`telegram/jobs/` is the canonical queue directory despite its legacy name. `jobs/` stores artifacts, not lifecycle truth.

## Main flows

### HTTP gateway flow

```text
client
  -> POST /run
  -> queue.enqueueJob(chatId = gateway-<uuid> unless supplied)
  -> gateway drainer starts pi-worker-run-job
  -> worker-runner claims queue job
  -> ACPX runtime adapter starts one turn
  -> queue.completeJob/failJob
  -> client polls GET /jobs/<jobId>
```

Gateway rejects numeric `chatId` values because numeric chats are reserved for Telegram delivery.

### Telegram flow

```text
Telegram /run <prompt>
  -> bot validates allowed chat
  -> queue.enqueueJob(chatId = numeric Telegram chat id)
  -> bot drainer starts pi-worker-run-job
  -> worker-runner claims queue job
  -> ACPX runtime adapter starts one turn
  -> queue.completeJob/failJob
  -> bot delivers final answer for numeric chat id
```

### ACP stdio adapter flow

```text
acpx --agent "bun scripts/vm/pi-worker-acp-stdio.ts" "fix failing tests"
  -> ACP initialize/session.new/session.prompt over stdio
  -> adapter POSTs /run with chatId = acp-<uuid>
  -> adapter polls /jobs/<jobId>/events and maps records to ACP session/update
  -> adapter polls /jobs/<jobId> for terminal queue status
  -> adapter returns ACP PromptResponse { stopReason }
```

The adapter uses official ACP schema at the external boundary. Gateway JSON endpoints remain pi-worker internals.

### Reset / cancel flow

```text
/reset <chatId>
  -> requestCancelJobsForChat writes jobs/cancels/<jobId>.cancel for running jobs
  -> resetWorkerChatSession closes ACP session with discardPersistentState=true
  -> active runner heartbeat sees cancel marker
  -> runtime.cancel(jobId)
  -> runner cleans cancel marker in finally
```

## Job / result contract

### Queue record

```json
{
  "id": "2026-05-04T13-29-26-441Z-...",
  "chatId": "gateway-...",
  "prompt": "What tools do you have available?",
  "status": "pending",
  "createdAt": "2026-05-04T13:29:26Z",
  "startedAt": null,
  "completedAt": null,
  "answer": null,
  "error": null,
  "backend": "acpx",
  "resultFormat": "text"
}
```

### Result artifact

```json
{
  "id": "2026-05-04T13-29-26-441Z-...",
  "backendId": "acpx",
  "status": "done",
  "answer": "...",
  "completedAt": "2026-05-04T13:29:28Z"
}
```

Failure artifact:

```json
{
  "id": "2026-05-04T13-29-26-441Z-...",
  "backendId": "acpx",
  "status": "failed",
  "error": "...",
  "completedAt": "2026-05-04T13:39:28Z"
}
```

### Event artifact

`~/.pi-worker/jobs/events/<jobId>.ndjson` contains `session_ready`, normalized ACPX runtime events, and terminal `turn_result` records.

## Concurrency model

- Persistent mode serializes same-chat turns with `acpx-turn-${agent}-${chatId}`.
- Oneshot mode locks by `acpx-turn-${jobId}`.
- File locks use `O_EXCL` to coordinate subprocesses.
- Different persistent chats can run independently.

## Stable vs unfinished

Stable now:

- ACPX-only job execution
- ACP-compatible stdio adapter smoke path for `acpx --agent "bun scripts/vm/pi-worker-acp-stdio.ts" ...`
- queue as lifecycle authority
- result-channel request/result/event artifacts
- per-session turn locking
- persistent ACP sessions
- reset/cancel markers
- local smoke tests with and without tmux
- OrbStack ACPX smoke path

Still intentionally unfinished:

- richer ACP conformance suite beyond stdio smoke
- Telegram streaming of structured ACPX events
- Bun-native daemon replacing tmux operator plane
- state directory rename from `telegram/jobs/` to `jobs/queue/`
- ACPX attachments and flow-run support
