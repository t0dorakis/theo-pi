# Pi Worker Glossary

| Canonical term | Definition | Avoided aliases |
| --- | --- | --- |
| **Worker** | Supervised pi-worker process running on the VM or in smoke tests. | session, tmux session, runtime |
| **Worker name** | Stable label for a Worker, from `PI_WORKER_NAME` or legacy `PI_WORKER_SESSION`. | `sessionName`, `activeSessionName` |
| **Worker daemon status** | Process lifecycle status: `starting`, `running`, `stale`, `failed`, `stopped`. | runtime status |
| **Job** | One queued prompt that produces one answer envelope. | task, run, request |
| **Turn** | One `AcpxRuntime.startTurn` call. | job |
| **Outer ACP session** | Session created by an external ACP client against the `theo-pi` stdio adapter. | ACPX session, worker session |
| **Inner ACP session** | Conversation state owned by ACPX. | outer ACP session, worker session, tmux session, Telegram session |
| **Session key** | ACPX conversation key: `${agent}-${chatId}` or `${jobId}`. | session id |
| **Chat / chatId** | Persistence and delivery scope; numeric means Telegram, non-numeric means queue-only. | user |
| **Agent** | ACP adapter selected by `ACPX_AGENT`. | model, assistant |
| **Runtime adapter** | Bridge between `WorkerJob` records and ACPX runtime calls. | backend |
| **Queue** | Authoritative job lifecycle store. | result channel |
| **Result channel** | Per-job artifact files: request, result, events, cancel, lease. | queue |
| **Operator plane** | Process-control surface: start, stop, status, restart, checkpoint, logs. | execution plane |
| **Execution plane** | Job execution surface: gateway, Telegram bot, ACP stdio adapter, runner, queue, ACPX. | operator plane |
