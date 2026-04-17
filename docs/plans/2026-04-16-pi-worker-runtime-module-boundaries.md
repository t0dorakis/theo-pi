# Pi Worker Runtime Module Boundaries

## Goal

Freeze current runtime responsibilities before refactor so Bun-first extraction can happen without breaking current VM operator flow, Telegram relay, or HTTP gateway behavior.

## Layer Model

```text
host/bootstrap layer
  -> runtime core layer
  -> transport adapters layer
  -> execution backend layer
```

Each layer should own one kind of concern and depend only downward.

## 1. Host / Bootstrap Layer

Purpose:
- install dependencies
- lay down wrappers in `~/bin`
- prepare VM runtime directories
- provide operator-facing compatibility entrypoints
- bridge host shell environment into Bun runtime

Current scripts in this layer:
- `scripts/vm/bootstrap-ubuntu-pi-worker.sh`
- `scripts/vm/install-theo-pi-worker.sh`
- `scripts/vm/pi-worker-start`
- `scripts/vm/pi-worker-status`
- `scripts/vm/pi-worker-restart`
- `scripts/vm/pi-worker-stop`
- `scripts/vm/pi-worker-checkpoint`
- `scripts/vm/pi-worker-tail-logs`
- `scripts/vm/pi-worker-verify-runtime`
- `scripts/vm/pi-worker-gateway`
- `scripts/vm/pi-worker-telegram-bot`
- `scripts/vm/pi-worker-submit-job`
- `scripts/vm/pi-worker-run-job`

Rules:
- keep Bash here thin
- no durable queue/state logic here after refactor
- preserve current command names and operator UX

## 2. Runtime Core Layer

Purpose:
- own canonical runtime state under `~/.pi-worker/`
- evaluate health and readiness
- own request/job/result contracts
- own queue/lease semantics
- expose reusable command handlers for adapters
- hide storage details behind shared modules

Current code/scripts moving toward this layer:
- `scripts/vm/pi-worker-supervisor` (currently mixes shell + state machine)
- `scripts/vm/pi-worker-submit-job.ts`
- `scripts/vm/pi-worker-run-job.ts`
- shared Bun modules to be added under `scripts/vm/lib/`

Target responsibilities after refactor:
- state store
- health evaluator
- supervisor core
- job queue
- result channel
- backend registry
- shared runtime command handlers

## 3. Transport Adapters Layer

Purpose:
- translate transport-specific requests into runtime-core commands
- format runtime-core results back into transport responses
- keep auth/webhook/polling concerns out of runtime core

Current scripts in this layer:
- `scripts/vm/pi-worker-gateway.ts`
- `scripts/vm/pi-worker-telegram-bot.ts`

Adapter responsibilities:
- HTTP request parsing and auth
- Telegram webhook/polling protocol handling
- command normalization
- transport-specific response formatting

Rules:
- adapters should not mutate job JSON directly
- adapters should not scrape tmux panes directly
- adapters should call runtime-core APIs/contracts

## 4. Execution Backend Layer

Purpose:
- execute normalized prompt requests against real worker runtime
- produce normalized results and health signals
- keep backend-specific process/session details hidden from adapters

Current v1 backend:
- local `tmux` Pi session
- `scripts/vm/pi-worker-delegate` for prompt injection
- pane capture behavior currently embedded in `scripts/vm/pi-worker-run-job.ts`

Target backend surface:
- `submitPrompt(request)`
- `readResult(requestId)`
- `cancel(requestId)`
- `sessionHealth()`

Rules:
- only backend layer knows tmux/session details
- rest of runtime depends on explicit request/result contracts
- future container/remote backend should fit same shape

## Current Script Placement Snapshot

### Mostly host/bootstrap
- `bootstrap-ubuntu-pi-worker.sh`
- `install-theo-pi-worker.sh`
- all `pi-worker-*` Bash wrappers except supervisor internals and delegate

### Mixed runtime-core + backend today
- `pi-worker-supervisor`
- `pi-worker-run-job.ts`
- `pi-worker-submit-job.ts`

### Transport adapters today
- `pi-worker-gateway.ts`
- `pi-worker-telegram-bot.ts`

### Backend-specific today
- `pi-worker-delegate`
- tmux capture logic inside `pi-worker-run-job.ts`

## Dependency Direction

Required direction:

```text
host/bootstrap -> runtime core -> execution backend
transport adapters -> runtime core -> execution backend
```

Not allowed target state:
- transport adapters writing raw JSON state files themselves
- gateway or Telegram code calling tmux directly for result scraping
- backend code owning queue policy

## Compatibility Rule During Refactor

Throughout refactor:
- keep `~/bin/pi-worker-*` commands working
- keep current local VM workflow working
- keep current HTTP gateway endpoints working
- keep current Telegram operator flow working
- prefer compatibility wrappers over flag-day rewrites

## Acceptance Criteria

This boundary doc is successful if:
- each runtime concern has one clear owning layer
- current scripts are mapped to target layers
- future module extraction can happen without re-deciding architecture each task
- tmux remains backend detail, not control-plane contract
