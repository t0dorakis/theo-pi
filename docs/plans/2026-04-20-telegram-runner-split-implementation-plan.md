# Telegram Runner Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split Telegram polling from job execution/delivery so SmolVM-backed and tmux-backed Telegram jobs drain reliably without depending on one monolithic bot loop.

**Architecture:** Keep current file-backed queue and backend abstraction. Refactor Telegram code into shared Telegram API helpers, a poller process that only enqueues/control-handles, and a runner process that independently claims jobs, sends typing, executes backend work, and delivers final answers. Copy OpenClaw’s narrow module boundaries and shared transport helpers where useful, not its plugin complexity.

**Tech Stack:** Bun, TypeScript, existing runtime queue/result files, Telegram Bot HTTP API, current worker backends (`tmux`, `smolvm`), local smoke tests.

---

### Task 1: Freeze current Telegram/runtime seams before split

**Files:**
- Read: `scripts/vm/pi-worker-telegram-bot.ts`
- Read: `scripts/vm/pi-worker-run-job.ts`
- Read: `scripts/vm/lib/jobs.ts`
- Read: `scripts/vm/lib/state-store.ts`
- Read: `scripts/vm/lib/result-channel.ts`
- Read: `docs/plans/2026-04-20-telegram-runner-split-design.md`
- Read: `/tmp/pi-github-repos/openclaw/openclaw@main/extensions/telegram/api.ts`
- Read: `/tmp/pi-github-repos/openclaw/openclaw@main/extensions/telegram/runtime-api.ts`

**Step 1: Record which functions move to poller vs runner**

Make explicit list:
- stays in poller
- moves to runner
- becomes shared helper

**Step 2: Confirm queue/result fields already cover retry and delivery needs**

Specifically verify `telegramDeliveredAt`, `leaseOwner`, `leaseExpiresAt`, `status`, `answer`, and `error` are enough.

**Step 3: Commit nothing**

### Task 2: Extract shared Telegram API helper with failing tests first

**Files:**
- Create: `scripts/vm/lib/telegram-api.ts`
- Create: `scripts/vm/lib/telegram-api.test.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`
- Test: `scripts/vm/lib/telegram-api.test.ts`

**Step 1: Write failing tests for shared Telegram helper**

Cover:
- `sendMessage` chunks long text
- `sendChatAction` sends typing action
- `assertAllowed` accepts wildcard `*`
- API error surfaces useful message

**Step 2: Run test to verify fail**

Run:
```bash
bun test scripts/vm/lib/telegram-api.test.ts
```

Expected: FAIL because helper does not exist yet.

**Step 3: Implement minimal shared helper**

Functions to export:
- `createTelegramApi(...)`
- `sendMessage(chatId, text)`
- `sendChatAction(chatId, action)`
- `assertAllowed(chatId)`

Inject fetch for testability.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/telegram-api.test.ts
node --check scripts/vm/lib/telegram-api.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/lib/telegram-api.ts scripts/vm/lib/telegram-api.test.ts scripts/vm/pi-worker-telegram-bot.ts
 git commit -m "refactor: extract telegram api helper"
```

### Task 3: Extract poller-only behavior from current bot

**Files:**
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`
- Create: `scripts/vm/lib/telegram-poller.ts`
- Create: `scripts/vm/lib/telegram-poller.test.ts`
- Test: `scripts/vm/lib/telegram-poller.test.ts`

**Step 1: Write failing poller tests**

Cover:
- plain text enqueues prompt job
- `/run` enqueues prompt job
- `/help` responds immediately
- `/status` stays poller-side
- poller does not invoke `pi-worker-run-job`

**Step 2: Implement poller module**

Move message parsing and enqueue/control handling into `telegram-poller.ts`.

Poller should only:
- parse updates
- call queue enqueue
- call Telegram helper for control responses

**Step 3: Reduce entrypoint to wiring**

`pi-worker-telegram-bot.ts` becomes thin wrapper around poller loop.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/telegram-poller.test.ts scripts/vm/lib/telegram-api.test.ts
node --check scripts/vm/pi-worker-telegram-bot.ts scripts/vm/lib/telegram-poller.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/pi-worker-telegram-bot.ts scripts/vm/lib/telegram-poller.ts scripts/vm/lib/telegram-poller.test.ts
 git commit -m "refactor: make telegram bot poller enqueue-only"
```

### Task 4: Add dedicated Telegram runner loop with failing tests first

**Files:**
- Create: `scripts/vm/pi-worker-telegram-runner.ts`
- Create: `scripts/vm/lib/telegram-runner.ts`
- Create: `scripts/vm/lib/telegram-runner.test.ts`
- Modify: `scripts/vm/lib/jobs.ts` (only if tiny helper needed)
- Test: `scripts/vm/lib/telegram-runner.test.ts`

**Step 1: Write failing runner tests**

Cover:
- claims oldest pending job FIFO
- skips already delivered jobs
- delivers `done` answer and marks delivered
- delivers `failed` error and marks delivered
- retries undelivered result on next loop
- reaps expired leases before claim

**Step 2: Implement runner loop module**

Runner module should:
- load jobs
- reap leases
- claim next pending
- execute `pi-worker-run-job` or backend work path
- deliver result through shared Telegram helper
- mark delivered

Keep main loop testable by injecting:
- sleep
- runLocal
- Telegram helper
- queue/state adapter

**Step 3: Add thin executable**

`pi-worker-telegram-runner.ts` should run infinite loop with short idle sleep.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/telegram-runner.test.ts
node --check scripts/vm/pi-worker-telegram-runner.ts scripts/vm/lib/telegram-runner.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/pi-worker-telegram-runner.ts scripts/vm/lib/telegram-runner.ts scripts/vm/lib/telegram-runner.test.ts scripts/vm/lib/jobs.ts
 git commit -m "feat: add telegram runner loop"
```

### Task 5: Move typing heartbeat ownership into runner

**Files:**
- Modify: `scripts/vm/lib/telegram-runner.ts`
- Modify: `scripts/vm/lib/telegram-runner.test.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`

**Step 1: Add failing typing tests**

Cover:
- runner sends typing immediately after claim
- runner refreshes typing during active job
- runner stops typing after answer/error send
- poller no longer sends execution typing

**Step 2: Implement minimal typing loop**

Use interval/timer around active job only.

Ensure cleanup in `finally` so timers do not leak.

**Step 3: Remove poller typing for queued jobs**

Poller may optionally send a one-shot acknowledgement but must not own execution typing lifecycle.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/telegram-runner.test.ts scripts/vm/lib/telegram-poller.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/lib/telegram-runner.ts scripts/vm/lib/telegram-runner.test.ts scripts/vm/pi-worker-telegram-bot.ts
 git commit -m "feat: move telegram typing heartbeat to runner"
```

### Task 6: Add wrapper/script support and docs for split model

**Files:**
- Create: `scripts/vm/pi-worker-telegram-runner`
- Modify: `scripts/vm/bootstrap-ubuntu-pi-worker.sh`
- Modify: `README.md`
- Modify: `docs/plans/2026-04-16-telegram-polling-bot-notes.md`

**Step 1: Add executable wrapper**

Create shell wrapper for new runner:
```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "$SCRIPT_DIR/pi-worker-telegram-runner.ts" "$@"
```

**Step 2: Update install/bootstrap script if needed**

Ensure new wrapper is copied/marked executable where current worker scripts are installed.

**Step 3: Update docs**

Document that Telegram now requires:
- poller process
- runner process
- shared state dir

**Step 4: Run syntax checks**

Run:
```bash
node --check scripts/vm/pi-worker-telegram-runner.ts scripts/vm/pi-worker-telegram-bot.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/pi-worker-telegram-runner scripts/vm/bootstrap-ubuntu-pi-worker.sh README.md docs/plans/2026-04-16-telegram-polling-bot-notes.md
 git commit -m "docs: wire split telegram runner"
```

### Task 7: Add fake-backed Telegram split smoke test

**Files:**
- Create: `scripts/vm/pi-worker-telegram-split-smoke-test`
- Possibly create: `scripts/vm/test-bin/fake-telegram-api`
- Possibly modify: `scripts/vm/lib/telegram-api.ts`
- Test: smoke script

**Step 1: Build fake Telegram endpoint or injected fetch path**

It must record:
- sent typing actions
- sent messages
- delivery order

**Step 2: Build smoke around shared state dir**

Smoke should:
- simulate incoming update into poller path
- verify prompt enqueued
- start runner
- verify result delivered and job marked `telegramDeliveredAt`
- verify delivery still works if poller process exits before runner drains

**Step 3: Run smoke**

Run:
```bash
bash scripts/vm/pi-worker-telegram-split-smoke-test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/vm/pi-worker-telegram-split-smoke-test scripts/vm/test-bin/fake-telegram-api scripts/vm/lib/telegram-api.ts
 git commit -m "test: add telegram poller runner split smoke test"
```

### Task 8: Extend real SmolVM smoke coverage over gateway/backend path

**Files:**
- Modify: `scripts/vm/pi-worker-gateway-smolvm-smoke-test`
- Possibly create: `scripts/vm/pi-worker-telegram-runner-smolvm-smoke-test`

**Step 1: Reuse same real SmolVM instance path**

Add check that split runner path can execute and deliver using current real guest bootstrap.

**Step 2: Keep test lightweight**

Use same `SMOLVM_BIN` and auth path env pattern already proven.

**Step 3: Run smoke**

Run:
```bash
SMOLVM_BIN="$PWD/external/SmolVM/.venv/bin/smolvm" SMOLVM_HOST_PI_AUTH_PATH="$HOME/.pi/agent/auth.json" scripts/vm/pi-worker-gateway-smolvm-smoke-test
```

And if added:
```bash
SMOLVM_BIN="$PWD/external/SmolVM/.venv/bin/smolvm" SMOLVM_HOST_PI_AUTH_PATH="$HOME/.pi/agent/auth.json" scripts/vm/pi-worker-telegram-runner-smolvm-smoke-test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/vm/pi-worker-gateway-smolvm-smoke-test scripts/vm/pi-worker-telegram-runner-smolvm-smoke-test
 git commit -m "test: verify split telegram runner against smolvm"
```

### Task 9: Run live bot verification with new process split

**Files:**
- Modify docs/progress only if behavior changes need recording

**Step 1: Start poller and runner separately**

Example:
```bash
scripts/vm/pi-worker-telegram-bot-smolvm &
bun scripts/vm/pi-worker-telegram-runner.ts &
```

Or wrapper once added:
```bash
scripts/vm/pi-worker-telegram-bot-smolvm &
scripts/vm/pi-worker-telegram-runner &
```

**Step 2: Send fresh Telegram plain-text prompt**

Expected:
- prompt enqueued immediately
- runner sends typing during execution
- final answer arrives without manual intervention

**Step 3: Kill poller during queued work**

Expected:
- runner still drains already queued job
- final answer still delivered

**Step 4: Kill runner, restart it, and resend**

Expected:
- pending job resumes/drains on runner restart
- no indefinite pending state

**Step 5: Capture evidence**

Save final observations in progress/doc updates.

### Task 10: Final docs, progress, and validation

**Files:**
- Modify: `.agent/progress.md`
- Modify: `.agent/tasks.json` via task tool
- Modify: `README.md`
- Modify: `docs/plans/2026-04-16-telegram-polling-bot-notes.md`
- Optionally modify: `docs/architecture.md`

**Step 1: Document operational model clearly**

Record:
- poller vs runner responsibilities
- required start commands
- shared state dir contract
- stale-job recovery behavior

**Step 2: Update progress/task state**

Record what passed, what remains, and next best step.

**Step 3: Run final validation**

Run:
```bash
npm run check
bun test scripts/vm/lib/*.test.ts scripts/vm/lib/backends/*.test.ts
bash scripts/vm/pi-worker-telegram-split-smoke-test
SMOLVM_BIN="$PWD/external/SmolVM/.venv/bin/smolvm" SMOLVM_HOST_PI_AUTH_PATH="$HOME/.pi/agent/auth.json" scripts/vm/pi-worker-gateway-smolvm-smoke-test
```

If live bot validation also passed, record exact command and result.

**Step 4: Commit**

```bash
git add .agent/progress.md README.md docs/architecture.md docs/plans/2026-04-16-telegram-polling-bot-notes.md
 git commit -m "refactor: split telegram poller and runner"
```

## Notes for executor

- Do not redesign queue format unless tests prove it insufficient.
- Keep Telegram helper shared between poller and runner.
- Prefer explicit injected dependencies for tests over global monkeypatching.
- Keep runner single-threaded and FIFO for now.
- Delivery mark must happen only after successful Telegram send.
- Preserve current SmolVM and tmux backend compatibility.
