# Pi Worker Context

Pi worker runs queued prompts from HTTP, Telegram, CLI, or an ACP-compatible stdio adapter through ACPX. `docs/plans/pi-worker-acpx-roadmap.md` tracks current follow-up work; this file describes current branch reality.

## Language

**Worker**:
Supervised pi-worker process running on the VM or local smoke-test environment.
_Avoid_: Session, tmux session, runtime

**Worker name**:
Stable label for a **Worker**, read from `PI_WORKER_NAME` or legacy `PI_WORKER_SESSION`.
_Avoid_: sessionName, activeSessionName

**Worker daemon status**:
Lifecycle status of a **Worker**: `starting`, `running`, `stale`, `failed`, or `stopped`.
_Avoid_: runtime status

**Job**:
Queued prompt that produces one answer envelope.
_Avoid_: Task, run, request

**Turn**:
One `AcpxRuntime.startTurn` call inside an **Inner ACP session**.
_Avoid_: Job

**Outer ACP session**:
Session created by an external ACP client against the `theo-pi` stdio adapter; its `sessionId` maps to a non-numeric `chatId`.
_Avoid_: ACPX session, Worker session

**Inner ACP session**:
Conversation state owned by ACPX for one agent and session key.
_Avoid_: Outer ACP session, Worker session, tmux session, Telegram session

**Session key**:
ACPX conversation key: `${agent}-${chatId}` for persistent mode, `${jobId}` for oneshot mode.
_Avoid_: Session ID

**Chat**:
Persistence and delivery scope for a **Job**; numeric `chatId` means Telegram delivery, non-numeric `chatId` means queue-only delivery.
_Avoid_: User

**Agent**:
ACP adapter selected by `ACPX_AGENT`, such as `pi` or `claude`.
_Avoid_: Model, autonomous coding assistant

**Runtime adapter**:
Code that translates **WorkerJob** records into ACPX sessions, turns, results, and event logs.
_Avoid_: Backend

**Queue**:
Authoritative lifecycle store for **Jobs**.
_Avoid_: Result channel

**Result channel**:
Per-job artifact files for requests, results, events, cancels, and leases.
_Avoid_: Queue

**Operator plane**:
Process-control layer for start, stop, status, restart, checkpoint, and logs.
_Avoid_: Execution plane

**Execution plane**:
Gateway, Telegram bot, ACP stdio adapter, worker runner, queue, result channel, and ACPX runtime adapter.
_Avoid_: Operator plane

## Relationships

- A **Worker** has one **Worker name**.
- An **Outer ACP session** maps to one non-numeric **Chat**.
- A **Job** maps to exactly one ACPX **Turn** today.
- A persistent **Job** uses one **Session key** shared by all jobs in the same **Chat** and **Agent**.
- A oneshot **Job** uses its own **Session key** equal to `jobId`.
- The **Queue** owns lifecycle state: `pending -> running -> done | failed`.
- The **Result channel** stores artifacts for a **Job** but does not own lifecycle truth.
- The **Operator plane** may supervise worker processes, but the **Execution plane** owns job execution.
- The **Runtime adapter** is the only execution path; tmux and smolvm execution backends are removed.

## Invariants

- All ingress paths enqueue **Jobs** before execution.
- ACPX is the sole execution runtime.
- Same-chat persistent turns are serialized with `acpx-turn-${agent}-${chatId}`.
- Oneshot turns lock by `acpx-turn-${jobId}`.
- Numeric `chatId` values are reserved for Telegram delivery.
- Non-numeric `chatId` values are queue-only; gateway-generated IDs use `gateway-${uuid}` and ACP adapter IDs use `acp-${uuid}`.
- Cross-process file locks use `O_EXCL` because gateway, Telegram, CLI, and run-job subprocesses can touch the same state.
- `backendId: "acpx"` is retained only as metadata; there is no backend registry.

## Filesystem layout

```text
~/.pi-worker/
├── state.json, health.json, heartbeat.json    # worker/operator state
├── sessions/<workerName>.json                 # worker state; legacy directory name
├── checkpoints/                               # operator artifacts
├── session-locks/                             # O_EXCL locks
├── acp/                                       # ACPX_STATE_DIR
│   └── sessions/...                           # ACP session records
├── telegram/jobs/<jobId>.json                 # canonical queue records; legacy directory name
└── jobs/
    ├── requests/<jobId>.json                  # request snapshot
    ├── results/<jobId>.json                   # result envelope artifact
    ├── events/<jobId>.ndjson                  # ACPX event log
    ├── cancels/<jobId>.cancel                 # cross-process cancel marker
    ├── leases/                                # lease bookkeeping
    └── runner.log                             # gateway-spawned runner logs
```

## Example dialogue

> **Dev:** "When a Telegram message arrives, do we call ACPX directly?"
> **Domain expert:** "No. Telegram creates a **Job** in the **Queue**. The runner claims that job, starts one ACPX **Turn**, writes **Result channel** artifacts, then marks the **Queue** done or failed."
>
> **Dev:** "Can two messages in the same chat run concurrently?"
> **Domain expert:** "No. Persistent **Inner ACP sessions** serialize by **Session key** so chat context stays ordered. Different chats can run independently."

## Flagged ambiguities

- "session" used to mean worker process, tmux session, Telegram chat, outer ACP session, inner ACP session, and ACP protocol id. Resolution: use **Outer ACP session** for external client state, **Inner ACP session** for ACPX conversation state, and **Worker** / **Worker name** for process state.
- "backend" used to imply a pluggable execution registry. Resolution: use **Runtime adapter** for the ACPX bridge and keep `backendId` only as artifact metadata.
- "runtime" used for Bun, ACPX, and daemon state. Resolution: prefer **ACPX runtime** for `AcpxRuntime`, **Worker env** for config, and **Worker daemon status** for process health.
