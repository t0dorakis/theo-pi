# Pi Worker Architecture

Current merged runtime for Theo's local Pi worker.

## Topology

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║ macOS host                                                                 ║
║  └─ OrbStack VM: `theo-pi` (Ubuntu)                                        ║
║      └─ runtime user: current local setup uses `/home/minimi`              ║
║                                                                             ║
║      Operator / host integration layer                                     ║
║      ───────────────────────────────────────────────────────────────────    ║
║      SSH / tmux / OrbStack / `~/bin/pi-worker-*` wrappers                  ║
║      `scripts/vm/bootstrap-ubuntu-pi-worker.sh`                            ║
║      `scripts/vm/pi-worker-instance`                                       ║
║                                │                                            ║
║                                ▼                                            ║
║      Runtime control layer                                                 ║
║      ───────────────────────────────────────────────────────────────────    ║
║      `pi-worker-supervisor`                                                ║
║      - starts/stops tmux-backed Pi session                                 ║
║      - writes state / heartbeat / health / checkpoints                     ║
║      - exposes start/status/restart/stop/checkpoint/verify/tail-logs       ║
║                                │                                            ║
║                                ▼                                            ║
║      Bun runtime core                                                      ║
║      ───────────────────────────────────────────────────────────────────    ║
║      `scripts/vm/lib/`                                                     ║
║      - env / paths / types                                                 ║
║      - state-store / json-file / health / time                             ║
║      - jobs / job-lease / result-channel                                   ║
║      - backend interface                                                   ║
║                                │                                            ║
║                  ┌─────────────┴─────────────┐                              ║
║                  ▼                           ▼                              ║
║      Transport adapters              Execution backend                      ║
║      ───────────────────            ───────────────────                     ║
║      `pi-worker-gateway.ts`         `backends/tmux-backend.ts`             ║
║      `pi-worker-telegram-bot.ts`    `pi-worker-delegate`                   ║
║      HTTP + Telegram UX             single tmux Pi session                 ║
║                  │                           │                              ║
║                  └─────────────┬─────────────┘                              ║
║                                ▼                                            ║
║      Pi session + workspace execution                                       ║
║      ───────────────────────────────────────────────────────────────────    ║
║      tmux session: `theo-pi`                                                ║
║      Pi CLI + repo workspace under `~/workspaces/theo-pi`                  ║
║      bash / git / node / bun / jq / rg / gh                                ║
╚══════════════════════════════════════════════════════════════════════════════╝
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
│   ├── <session>.json
│   ├── <session>.stop
│   └── <session>.supervisor.pid
├── checkpoints/
│   ├── latest.json
│   └── <label>-<timestamp>.json
├── telegram/
│   └── jobs/
│       └── <jobId>.json
└── jobs/
    ├── requests/
    │   └── <jobId>.json
    ├── results/
    │   └── <jobId>.json
    └── leases/
```

## Main flows

### 1. Operator flow

```text
operator -> SSH / orbctl -> tmux / ~/bin/pi-worker-* -> supervisor/runtime
```

### 2. HTTP gateway flow

```text
client -> pi-worker-gateway -> runtime core -> tmux backend -> Pi session
```

### 3. Telegram flow

```text
Telegram message
  -> pi-worker-telegram-bot
  -> enqueue telegram job
  -> pi-worker-run-job
  -> tmux backend injects prompt into live Pi session
  -> result-channel writes jobs/results/<jobId>.json
  -> bot sends only final answer
```

## Job / result contract

Current runtime uses explicit request/result files so transports do not need to scrape tmux directly.

### Request

```json
{
  "id": "2026-04-19T13-29-26-441Z-...",
  "backendId": "tmux",
  "createdAt": "2026-04-19T13:29:26Z",
  "acceptedAt": "2026-04-19T13:29:26Z",
  "leaseOwner": "runner-theo-pi",
  "leaseExpiresAt": "2026-04-19T13:34:26Z",
  "resultChannel": "file:/home/minimi/.pi-worker/jobs/results/<jobId>.json",
  "request": {
    "prompt": "What tools do you have available?"
  }
}
```

### Result

```json
{
  "id": "2026-04-19T13-29-26-441Z-...",
  "backendId": "tmux",
  "status": "done",
  "answer": "read, bash, edit, write, auto_skill_manage, web_search, code_search, fetch_content, get_search_content",
  "completedAt": "2026-04-19T13:29:28Z"
}
```

Failure shape:

```json
{
  "id": "2026-04-19T13-29-26-441Z-...",
  "backendId": "tmux",
  "status": "failed",
  "error": "missing or malformed <final_answer> block after 600s",
  "completedAt": "2026-04-19T13:39:28Z"
}
```

## Current prompt/result boundary

Runtime currently asks Pi to answer with exactly one XML element:

```text
<final_answer id="...">...</final_answer>
```

Important implementation detail:
- delegated prompt must stay single-line when injected through tmux
- exact parse tags should appear only once in prompt text
- backend may inspect tmux pane, but higher layers read only formal result files

## Key scripts

| Script | Purpose |
| --- | --- |
| `scripts/vm/bootstrap-ubuntu-pi-worker.sh` | install system deps, Bun, Pi, wrappers, worker dirs |
| `scripts/vm/install-theo-pi-worker.sh` | clone/update repo and configure worker install in VM |
| `scripts/vm/pi-worker-supervisor` | supervised runtime shell entrypoint |
| `scripts/vm/pi-worker-gateway.ts` | Bun HTTP gateway |
| `scripts/vm/pi-worker-telegram-bot.ts` | Bun Telegram polling bot |
| `scripts/vm/pi-worker-submit-job.ts` | enqueue Telegram/runtime job |
| `scripts/vm/pi-worker-run-job.ts` | claim one job, drive backend, write result channel |
| `scripts/vm/pi-worker-delegate` | paste prompt into live tmux Pi session |
| `scripts/vm/pi-worker-instance` | lean dev helper for status/logs/sync/restart/clean-stuck |
| `scripts/vm/pi-worker-runtime-checklist` | real-VM runtime verification |
| `scripts/vm/pi-worker-supervisor-smoke-test` | local temp-HOME supervisor smoke tests |
| `scripts/vm/pi-worker-gateway-smoke-test` | local temp-HOME gateway smoke tests |

## State machine snapshot

```text
start -> starting -> running
                    │
                    ├─ stop -> stopped
                    ├─ heartbeat stale -> stale
                    ├─ workspace missing -> failed
                    └─ Pi/tmux crash -> restart loop -> running | failed
```

## What is stable vs unfinished

Stable in current merged state:
- supervised tmux-backed Pi runtime
- machine-readable health/state files
- Bun gateway
- Telegram polling bot
- explicit queue + result channel
- tmux backend abstraction
- local smoke tests and real-VM verification path

Still intentionally unfinished from larger refactor plan:
- supervisor core moved fully into Bun
- shared runtime command handlers across gateway + Telegram
- queue resilience controls like `/queue` and `/cancel`
- cloud-transition seams and CI workflow hardening
