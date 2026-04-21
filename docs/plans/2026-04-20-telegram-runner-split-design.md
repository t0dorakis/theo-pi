# Telegram Runner Split Design

## Goal

Fix stuck Telegram jobs by splitting polling/enqueue responsibilities from job execution/delivery responsibilities, while keeping current file-backed queue and SmolVM backend contract.

## Problem

Current `scripts/vm/pi-worker-telegram-bot.ts` combines too many roles in one long-lived process:
- Telegram polling
- allowlist/command handling
- prompt enqueue
- typing heartbeats
- queue draining
- job execution trigger
- final answer delivery

In practice this created brittle behavior:
- pending jobs could sit forever even though backend execution worked
- typing state could continue while queue did not advance
- recovery depended on bot process state or manual nudges
- Telegram relay correctness was coupled to one in-memory `queueWorkerActive` loop

SmolVM backend proved execution viability, but it also made this bot-loop weakness more visible because jobs are slower and more stateful than trivial local delegate calls.

## Recommended architecture

Use two separate executables against the same state dir.

### 1. Poller process

Responsibilities:
- long-poll Telegram updates
- validate allowed chats
- handle control-plane commands:
  - `/help`
  - `/status`
  - `/restart`
  - `/logs`
  - `/checkpoint`
- convert plain text or `/run <prompt>` into queued job files
- return quickly after enqueue

Explicitly not responsible for:
- claiming jobs
- running backend work
- sending typing during execution
- delivering final job answers

### 2. Runner process

Responsibilities:
- loop forever on shared state dir
- reap expired leases
- claim oldest pending undelivered job
- send typing heartbeat while active job runs
- execute backend through existing runtime path
- send final answer or failure directly to Telegram
- write `telegramDeliveredAt` only after successful Telegram delivery

Explicitly not responsible for:
- reading Telegram updates
- interpreting chat commands beyond job payload already queued

## Shared state contract

Keep current filesystem contract as system boundary.

### Telegram queue records
- `~/.pi-worker/telegram/jobs/*.json`

Fields already sufficient for split model:
- `id`
- `chatId`
- `prompt`
- `status`
- `createdAt`
- `startedAt`
- `completedAt`
- `answer`
- `error`
- `telegramDeliveredAt`
- `leaseOwner`
- `leaseExpiresAt`
- `backend`

### Runtime request/result records
- `~/.pi-worker/jobs/requests/*.json`
- `~/.pi-worker/jobs/results/*.json`

These remain backend-facing contract below Telegram transport layer.

## OpenClaw ideas to copy

From OpenClaw Telegram extension, copy structure rather than product complexity:
- shared Telegram API/transport helpers
- small modules with narrow responsibility
- explicit runtime boundary instead of one large loop
- avoid hidden reliance on one process’s in-memory state

Do **not** copy extra OpenClaw features not needed for this fix:
- plugin scaffolding
- account multiplexing
- inline UX complexity
- thread/topic binding machinery

## Component plan

### Shared Telegram module

Create reusable helper module for:
- `api(method, body)`
- `sendMessage(chatId, text)`
- `sendChatAction(chatId, action)`
- chunking long responses
- allowlist check helper

Both poller and runner import this module so behavior stays consistent.

### Poller entrypoint

Keep or rename `scripts/vm/pi-worker-telegram-bot.ts` into poller role.

Flow:
1. receive Telegram update
2. validate chat
3. handle control commands immediately
4. enqueue prompt jobs for plain text and `/run`
5. optionally send one immediate acknowledgement or initial typing hint
6. stop there

### Runner entrypoint

Add new script, e.g. `scripts/vm/pi-worker-telegram-runner.ts`.

Flow:
1. ensure state dirs exist
2. forever:
   - reap expired leases
   - claim next pending job FIFO
   - if none, sleep short interval
   - send typing heartbeat loop for claimed job chat
   - run backend
   - send answer/error directly to Telegram
   - mark delivered
   - stop typing loop
3. continue

## Failure handling

### Stale running job

Runner must periodically call lease reaper. Any job whose lease expired returns to `pending` so a fresh runner can reclaim it.

### Runner crash after result write but before Telegram send

State should remain:
- `status: done` or `failed`
- `telegramDeliveredAt: null`

Next runner start must detect and deliver it once.

### Duplicate-send guard

Runner checks `telegramDeliveredAt` before any send. Only set it after Telegram API confirms success.

### Poller crash

No effect on already queued work. Runner still drains queue.

### Telegram API temporary failure

Runner should leave job undelivered if answer send fails. Retry on next loop rather than marking complete delivery falsely.

## Typing behavior

Runner owns typing while a job is active.

Why:
- typing reflects actual execution state
- poller exits enqueue path quickly
- no cross-process coordination needed for typing timestamps beyond current active chat

Typing policy:
- send `typing` immediately after claim
- refresh at configured interval while backend runs
- stop naturally once final answer/error is delivered

## Verification plan

### Unit tests
1. poller enqueues prompt and does not execute it
2. runner claims oldest pending job FIFO
3. runner skips jobs already delivered
4. runner sends final answer and marks delivered
5. runner sends error and marks delivered
6. lease reaper returns stale `running` job to `pending`
7. typing loop starts/stops around active job

### Smoke tests
1. fake Telegram API + fake backend local smoke
2. file-backed runner survives restart and still drains pending queue
3. real SmolVM-backed gateway smoke remains green
4. real Telegram bot run proves poller/runner split fixes stuck pending jobs

### Success criteria
- new plain-text Telegram prompt does not remain pending when poller is healthy and runner is alive
- bot delivery no longer depends on poller in-memory queue state
- restarting poller does not interrupt runner drain
- restarting runner resumes pending delivery without manual intervention

## Migration path

1. extract shared Telegram API helper first
2. keep current bot behavior temporarily while helper lands
3. add separate runner executable using same queue
4. remove execution/delivery logic from poller
5. update wrappers/docs/smoke tests
6. verify on real SmolVM bot

## Risks

- duplicate message delivery if delivery mark ordering is wrong
- lease handling bugs could cause repeated retries or stuck running jobs
- typing loop could leak timers if not cleaned up after job completion
- control commands must remain poller-only to avoid surprising behavior

## Recommendation

Implement split-process model now.

This is smallest architecture change that directly targets observed failure mode. Backend execution is already proven. Reliable queue draining and delivery are now limiting factor, and process separation addresses that more robustly than more patches to current monolithic bot loop.
