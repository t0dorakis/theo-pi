# Pi Worker Runtime Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the Pi worker runtime from a shell-first prototype into a layered Bun-first control plane with explicit job/result contracts, while preserving the current local VM workflow and operator ergonomics.

**Architecture:** Keep Bash only at host/setup edges and move runtime state management, queueing, gateway behavior, and Telegram orchestration into shared Bun/TypeScript modules. Introduce explicit request/result contracts so tmux becomes an execution backend detail rather than the primary API surface. Migrate incrementally behind compatibility wrappers so the real VM workflow stays usable throughout.

**Tech Stack:** Bun, TypeScript, Bash wrappers, tmux, jq/JSON state files, Pi CLI, OrbStack Ubuntu VM, Telegram Bot API.

---

## Refactor target

By end of this plan, runtime should look like this:

```text
Bash bootstrap/wrappers
        ->
Bun runtime library (state, health, jobs, worker backend, command handlers)
        ->
Adapters:
- CLI wrappers
- HTTP gateway
- Telegram bot
        ->
Execution backend:
- local tmux Pi session (v1)
- future container/remote backend (v2)
```

## Non-goals

- Do not replace tmux backend in this refactor.
- Do not add hosted cloud infra yet.
- Do not redesign Pi prompt behavior beyond what is needed for explicit contracts.
- Do not break existing `~/bin/pi-worker-*` operator commands.

## Guardrails

- Preserve current command names and operator UX unless explicitly replaced by compatible wrappers.
- Keep `~/.pi-worker/` as the primary runtime state root.
- Add tests for each extracted module before deleting equivalent shell logic.
- Land in small vertical slices with working VM verification after each phase.
- Prefer compatibility shims over flag days.

---

### Task 1: Freeze current runtime contract in docs

**Files:**
- Create: `docs/plans/2026-04-16-pi-worker-runtime-module-boundaries.md`
- Modify: `docs/plans/2026-04-14-pi-worker-runtime-state-layout.md`
- Modify: `docs/plans/2026-04-14-pi-worker-workspace-execution-interface.md`
- Modify: `docs/plans/2026-04-14-pi-worker-gateway-and-wake-hooks.md`

**Step 1: Write module-boundary doc**

Document four layers with exact responsibilities:
- host/bootstrap layer
- runtime core layer
- transport adapters layer
- execution backend layer

Include which current scripts belong to each layer.

**Step 2: Add explicit job/result contract to state-layout doc**

Add reserved layout:

```text
~/.pi-worker/
  telegram/
    jobs/
  jobs/
    requests/
    results/
    leases/
```

Add JSON fields for:
- request id
- backend id
- acceptedAt
- completedAt
- leaseOwner
- leaseExpiresAt
- result channel

**Step 3: Patch workspace execution interface spec**

Add explicit backend interface methods:
- `submitPrompt(request)`
- `readResult(requestId)`
- `cancel(requestId)`
- `sessionHealth()`

**Step 4: Patch gateway/wake-hook spec**

Change future gateway note from direct shell-command bridge to runtime API bridge.

**Step 5: Review docs for consistency**

Run:
```bash
rg -n "tmux|gateway|jobs|results|workspace execution" docs/plans/2026-04-1*.md docs/plans/2026-04-16-*.md
```

Expected: docs mention explicit request/result contracts and adapter/backend split consistently.

**Step 6: Commit**

```bash
git add docs/plans/2026-04-16-pi-worker-runtime-module-boundaries.md \
  docs/plans/2026-04-14-pi-worker-runtime-state-layout.md \
  docs/plans/2026-04-14-pi-worker-workspace-execution-interface.md \
  docs/plans/2026-04-14-pi-worker-gateway-and-wake-hooks.md
git commit -m "docs: define runtime module boundaries and job contracts"
```

---

### Task 2: Add Bun workspace foundations

**Files:**
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Modify: `package.json`
- Create: `scripts/vm/lib/`
- Create: `scripts/vm/lib/types.ts`
- Create: `scripts/vm/lib/env.ts`
- Create: `scripts/vm/lib/paths.ts`

**Step 1: Add TypeScript config**

Create `tsconfig.json` for Bun-run TS scripts with strict-enough settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowJs": false,
    "types": ["bun-types"]
  },
  "include": ["scripts/**/*.ts", "packages/**/*.ts"]
}
```

**Step 2: Add Bun config**

Create minimal `bunfig.toml` with test preload/config if needed, but keep small.

**Step 3: Add root scripts**

Patch `package.json` scripts:

```json
{
  "scripts": {
    "check": "node --check scripts/vm/pi-worker-gateway.ts scripts/vm/pi-worker-telegram-bot.ts scripts/vm/pi-worker-submit-job.ts scripts/vm/pi-worker-run-job.ts",
    "check:ts": "bunx tsc --noEmit",
    "test:vm": "bash scripts/vm/pi-worker-supervisor-smoke-test && bash scripts/vm/pi-worker-gateway-smoke-test"
  }
}
```

Keep existing workspace behavior intact.

**Step 4: Add shared runtime basics**

Create reusable modules:
- `types.ts` for canonical runtime/job types
- `env.ts` for env parsing/defaults
- `paths.ts` for state/script directories

Define exact types for:
- `HealthState`
- `SessionState`
- `WorkerJob`
- `WorkerJobStatus`

**Step 5: Verify**

Run:
```bash
bunx tsc --noEmit
npm run check
```

Expected: no type errors, syntax checks pass.

**Step 6: Commit**

```bash
git add tsconfig.json bunfig.toml package.json scripts/vm/lib
git commit -m "chore: add Bun runtime foundations"
```

---

### Task 3: Extract runtime state and health logic into shared Bun modules

**Files:**
- Create: `scripts/vm/lib/json-file.ts`
- Create: `scripts/vm/lib/state-store.ts`
- Create: `scripts/vm/lib/health.ts`
- Create: `scripts/vm/lib/time.ts`
- Test: `scripts/vm/lib/state-store.test.ts`
- Test: `scripts/vm/lib/health.test.ts`
- Modify: `scripts/vm/pi-worker-gateway.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`

**Step 1: Write failing tests for state store**

Test JSON reads/writes and null field normalization.

Example:
```ts
import { test, expect } from "bun:test"

test("writes and reads health state atomically", async () => {
  // setup temp dir
  // write health state
  // read it back
  // assert equality
})
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/state-store.test.ts scripts/vm/lib/health.test.ts
```

Expected: missing module failures.

**Step 3: Implement state store and health evaluation**

Move Bun-side readers/writers for:
- `state.json`
- `heartbeat.json`
- `health.json`
- Telegram job files

Implement pure health evaluation function from state inputs.

**Step 4: Update gateway and bot to import shared modules**

Replace inline path/env parsing and raw file conventions where possible.

**Step 5: Re-run tests**

Run:
```bash
bun test scripts/vm/lib/state-store.test.ts scripts/vm/lib/health.test.ts
bunx tsc --noEmit
```

Expected: PASS.

**Step 6: Commit**

```bash
git add scripts/vm/lib/json-file.ts scripts/vm/lib/state-store.ts scripts/vm/lib/health.ts scripts/vm/lib/time.ts scripts/vm/lib/*.test.ts scripts/vm/pi-worker-gateway.ts scripts/vm/pi-worker-telegram-bot.ts
git commit -m "refactor: extract runtime state and health modules"
```

---

### Task 4: Introduce explicit shared job queue library

**Files:**
- Create: `scripts/vm/lib/jobs.ts`
- Create: `scripts/vm/lib/job-lease.ts`
- Create: `scripts/vm/lib/jobs.test.ts`
- Modify: `scripts/vm/pi-worker-submit-job.ts`
- Modify: `scripts/vm/pi-worker-run-job.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`

**Step 1: Write failing queue tests**

Test:
- enqueue job
- claim next pending job
- mark running
- mark done
- mark failed
- skip delivered jobs
- recover stale lease

Example:
```ts
test("claims oldest pending job FIFO", async () => {
  // enqueue two jobs
  // claim next
  // expect first job id
})
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/jobs.test.ts
```

**Step 3: Implement explicit queue contract**

Add fields:
- `leaseOwner`
- `leaseExpiresAt`
- `backend`
- `resultFormat`

Add operations:
- `enqueueJob`
- `claimNextJob`
- `heartbeatLease`
- `completeJob`
- `failJob`
- `markDelivered`
- `reapExpiredLeases`

**Step 4: Patch submit/run/bot scripts to use library**

Remove ad-hoc sorting and direct JSON mutation from entry scripts.

**Step 5: Re-run tests**

Run:
```bash
bun test scripts/vm/lib/jobs.test.ts
bunx tsc --noEmit
```

**Step 6: Commit**

```bash
git add scripts/vm/lib/jobs.ts scripts/vm/lib/job-lease.ts scripts/vm/lib/jobs.test.ts scripts/vm/pi-worker-submit-job.ts scripts/vm/pi-worker-run-job.ts scripts/vm/pi-worker-telegram-bot.ts
git commit -m "refactor: add explicit queued job library"
```

---

### Task 5: Introduce execution-backend abstraction

**Files:**
- Create: `scripts/vm/lib/backend.ts`
- Create: `scripts/vm/lib/backends/tmux-backend.ts`
- Create: `scripts/vm/lib/backends/tmux-backend.test.ts`
- Modify: `scripts/vm/pi-worker-delegate`
- Modify: `scripts/vm/pi-worker-run-job.ts`
- Modify: `scripts/vm/pi-worker-gateway.ts`

**Step 1: Write failing backend tests**

Mock backend contract:
- submit prompt
- inspect result source
- read backend health

Test minimal adapter shape:
```ts
test("tmux backend formats delegated prompt request", async () => {
  // expect backend submit to call delegate with exact string
})
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/backends/tmux-backend.test.ts
```

**Step 3: Implement backend interface**

Define interface:

```ts
export interface WorkerBackend {
  submitPrompt(job: WorkerJob): Promise<void>
  readResult(job: WorkerJob): Promise<string | null>
  sessionHealth(): Promise<{ ok: boolean; detail?: string }>
  cancel?(jobId: string): Promise<void>
}
```

Implement `tmux-backend.ts` using existing tmux behavior.

**Step 4: Refactor runner/gateway to depend on backend interface**

`pi-worker-run-job.ts` should call backend module, not inline tmux capture logic.

**Step 5: Verify**

Run:
```bash
bun test scripts/vm/lib/backends/tmux-backend.test.ts
node --check scripts/vm/pi-worker-run-job.ts scripts/vm/pi-worker-gateway.ts
```

**Step 6: Commit**

```bash
git add scripts/vm/lib/backend.ts scripts/vm/lib/backends/tmux-backend.ts scripts/vm/lib/backends/tmux-backend.test.ts scripts/vm/pi-worker-delegate scripts/vm/pi-worker-run-job.ts scripts/vm/pi-worker-gateway.ts
git commit -m "refactor: add worker backend abstraction"
```

---

### Task 6: Replace screen-scraping contract with explicit result handoff

**Files:**
- Create: `scripts/vm/lib/result-channel.ts`
- Modify: `scripts/vm/lib/backends/tmux-backend.ts`
- Modify: `scripts/vm/pi-worker-run-job.ts`
- Modify: `docs/plans/2026-04-14-pi-worker-runtime-state-layout.md`
- Test: `scripts/vm/lib/result-channel.test.ts`

**Step 1: Write failing result-channel tests**

Test contract:
- request file written
- result file discovered
- malformed result rejected
- timeout produces failure state

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/result-channel.test.ts
```

**Step 3: Implement explicit result handoff**

Choose one minimal contract and stick to it:
- backend writes `~/.pi-worker/jobs/results/<jobId>.json`, or
- backend writes `~/.pi-worker/jobs/results/<jobId>.ndjson`

Required fields:
```json
{
  "id": "job-id",
  "status": "done",
  "answer": "final text",
  "completedAt": "...",
  "backend": "tmux"
}
```

**Step 4: Make tmux backend produce result file**

Short-term acceptable bridge:
- tmux backend still parses pane output internally
- but only backend sees that
- rest of runtime reads formal result file only

This removes pane scraping from queue/bot layers.

**Step 5: Update runner to consume result file, not pane text directly**

**Step 6: Verify**

Run:
```bash
bun test scripts/vm/lib/result-channel.test.ts
bunx tsc --noEmit
```

Then on real VM:
```bash
orbctl run -m theo-pi bash -lc '~/bin/pi-worker-submit-job 1204573995 "Reply with exactly: pong"'
```

Expected: corresponding result JSON file written under result channel path and job completes.

**Step 7: Commit**

```bash
git add scripts/vm/lib/result-channel.ts scripts/vm/lib/result-channel.test.ts scripts/vm/lib/backends/tmux-backend.ts scripts/vm/pi-worker-run-job.ts docs/plans/2026-04-14-pi-worker-runtime-state-layout.md
git commit -m "refactor: add explicit worker result channel"
```

---

### Task 7: Shrink Bash supervisor to shell adapter around Bun core

**Files:**
- Create: `scripts/vm/pi-worker-supervisor.ts`
- Create: `scripts/vm/lib/supervisor-core.ts`
- Create: `scripts/vm/lib/supervisor-core.test.ts`
- Modify: `scripts/vm/pi-worker-supervisor`
- Modify: `scripts/vm/pi-worker-start`
- Modify: `scripts/vm/pi-worker-status`
- Modify: `scripts/vm/pi-worker-restart`
- Modify: `scripts/vm/pi-worker-stop`
- Modify: `scripts/vm/pi-worker-checkpoint`
- Modify: `scripts/vm/pi-worker-tail-logs`
- Modify: `scripts/vm/pi-worker-verify-runtime`

**Step 1: Write failing supervisor-core tests**

Cover pure logic only:
- restart decision
- stale heartbeat evaluation
- stop transition
- failed workspace transition
- restart cap reached transition

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/supervisor-core.test.ts
```

**Step 3: Implement TS supervisor core**

Move state machine logic into Bun module.
Keep Bash responsible only for:
- invoking Bun entrypoint
- very thin compatibility wrappers

**Step 4: Convert `pi-worker-supervisor` into shim**

Pattern:
```bash
exec bun "$SCRIPT_DIR/pi-worker-supervisor.ts" "$@"
```

Preserve existing CLI surface exactly.

**Step 5: Re-run smoke tests**

Run:
```bash
bash scripts/vm/pi-worker-supervisor-smoke-test
bash scripts/vm/pi-worker-gateway-smoke-test
```

Expected: PASS with same operator behavior.

**Step 6: Real VM verification**

Run:
```bash
orbctl run -m theo-pi bash -lc '~/bin/pi-worker-runtime-checklist theo-pi'
```

Expected: PASS.

**Step 7: Commit**

```bash
git add scripts/vm/pi-worker-supervisor.ts scripts/vm/lib/supervisor-core.ts scripts/vm/lib/supervisor-core.test.ts scripts/vm/pi-worker-supervisor scripts/vm/pi-worker-start scripts/vm/pi-worker-status scripts/vm/pi-worker-restart scripts/vm/pi-worker-stop scripts/vm/pi-worker-checkpoint scripts/vm/pi-worker-tail-logs scripts/vm/pi-worker-verify-runtime
git commit -m "refactor: move supervisor core into Bun"
```

---

### Task 8: Unify gateway and Telegram command handling

**Files:**
- Create: `scripts/vm/lib/runtime-commands.ts`
- Create: `scripts/vm/lib/telegram-commands.ts`
- Test: `scripts/vm/lib/runtime-commands.test.ts`
- Modify: `scripts/vm/pi-worker-gateway.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`

**Step 1: Write failing command tests**

Test shared behaviors:
- status command returns JSON
- restart command returns success message
- checkpoint command normalizes label
- plain text maps to enqueue
- `/run` maps to enqueue

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/runtime-commands.test.ts
```

**Step 3: Implement shared command modules**

Keep transport-specific formatting separate from runtime actions.

**Step 4: Patch gateway and bot to call shared modules**

Goal: no duplicated control logic across entrypoints.

**Step 5: Verify**

Run:
```bash
bun test scripts/vm/lib/runtime-commands.test.ts
bash scripts/vm/pi-worker-gateway-smoke-test
```

**Step 6: Commit**

```bash
git add scripts/vm/lib/runtime-commands.ts scripts/vm/lib/telegram-commands.ts scripts/vm/lib/runtime-commands.test.ts scripts/vm/pi-worker-gateway.ts scripts/vm/pi-worker-telegram-bot.ts
git commit -m "refactor: unify runtime command handlers"
```

---

### Task 9: Add queue resilience and operator controls

**Files:**
- Modify: `scripts/vm/lib/jobs.ts`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts`
- Modify: `scripts/vm/pi-worker-gateway.ts`
- Modify: `README.md`
- Test: `scripts/vm/lib/jobs.test.ts`

**Step 1: Write failing tests for queue resilience**

Add tests for:
- expired running lease becomes pending again
- delivered job not re-sent
- `/queue` summary
- `/cancel <id>` or `/cancel latest`

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/jobs.test.ts
```

**Step 3: Implement resilience and commands**

Add:
- queue summary command
- cancel command
- stale lease reaper
- clearer failure messages

Keep YAGNI: no full dashboard.

**Step 4: Verify**

Run:
```bash
bun test scripts/vm/lib/jobs.test.ts
node --check scripts/vm/pi-worker-telegram-bot.ts scripts/vm/pi-worker-gateway.ts
```

Manual VM check:
- enqueue two prompts
- inspect FIFO behavior
- cancel one
- verify only remaining job completes

**Step 5: Commit**

```bash
git add scripts/vm/lib/jobs.ts scripts/vm/pi-worker-telegram-bot.ts scripts/vm/pi-worker-gateway.ts README.md scripts/vm/lib/jobs.test.ts
git commit -m "feat: add queue resilience and operator controls"
```

---

### Task 10: Add cloud-readiness seams without deploying cloud infra

**Files:**
- Create: `scripts/vm/lib/backend-registry.ts`
- Create: `scripts/vm/lib/state-adapter.ts`
- Create: `scripts/vm/lib/adapters/filesystem-state.ts`
- Create: `docs/plans/2026-04-16-cloud-transition-seams.md`
- Modify: `scripts/vm/lib/backends/tmux-backend.ts`
- Modify: `scripts/vm/lib/jobs.ts`

**Step 1: Write adapter seam doc**

Document replaceable interfaces for:
- state store
- execution backend
- job queue backend

**Step 2: Implement registry/adapters**

Even if only one implementation exists now, define interfaces explicitly.

**Step 3: Patch runtime modules to depend on interfaces**

No production behavior change expected.

**Step 4: Verify**

Run:
```bash
bunx tsc --noEmit
bun test scripts/vm/lib/*.test.ts scripts/vm/lib/backends/*.test.ts
```

**Step 5: Commit**

```bash
git add scripts/vm/lib/backend-registry.ts scripts/vm/lib/state-adapter.ts scripts/vm/lib/adapters/filesystem-state.ts docs/plans/2026-04-16-cloud-transition-seams.md scripts/vm/lib/backends/tmux-backend.ts scripts/vm/lib/jobs.ts
git commit -m "refactor: add cloud transition seams"
```

---

### Task 11: Harden release/dev workflow for publishability

**Files:**
- Create: `.github/workflows/vm-runtime-checks.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/plans/2026-04-16-bun-gateway-notes.md`
- Modify: `docs/plans/2026-04-16-telegram-polling-bot-notes.md`

**Step 1: Add CI workflow**

Run on PR:
- `bunx tsc --noEmit`
- package tests
- shell smoke tests
- gateway smoke test

**Step 2: Add explicit dev commands to README**

Document:
- `bun test`
- `bunx tsc --noEmit`
- smoke tests
- VM checklist

**Step 3: Patch docs to reflect Bun-first core and Bash-edge model**

**Step 4: Verify CI file syntax locally**

Run:
```bash
node --check .github/workflows/vm-runtime-checks.yml || true
npm run check
npm run test:vm
```

Expected: project checks pass; YAML syntax reviewed manually if needed.

**Step 5: Commit**

```bash
git add .github/workflows/vm-runtime-checks.yml package.json README.md docs/plans/2026-04-16-bun-gateway-notes.md docs/plans/2026-04-16-telegram-polling-bot-notes.md
git commit -m "chore: add Bun runtime CI and docs"
```

---

### Task 12: Final integration pass on real VM

**Files:**
- Modify: `.agent/progress.md`
- Modify: `.agent/tasks.json`

**Step 1: Sync latest scripts to VM**

Run exact sync commands for changed runtime files.

**Step 2: Re-bootstrap if needed**

Run:
```bash
orbctl run -m theo-pi bash -lc 'cd ~/workspaces/theo-pi && ./scripts/vm/bootstrap-ubuntu-pi-worker.sh'
```

**Step 3: Run full real checks**

Run:
```bash
orbctl run -m theo-pi bash -lc '~/bin/pi-worker-runtime-checklist theo-pi'
orbctl run -m theo-pi bash -lc 'curl -fsS http://127.0.0.1:8787/health | jq .'
```

**Step 4: Run live Telegram checks**

Verify from real bot chat:
- plain text prompt returns final answer
- `/status`
- `/restart`
- `/queue`
- `/cancel` if implemented

**Step 5: Update progress tracking**

Record what passed, what still uses tmux backend, and any remaining cloud-gap items.

**Step 6: Commit**

```bash
git add .agent/progress.md .agent/tasks.json
git commit -m "chore: record refactor verification status"
```

---

## Suggested execution order

Do not reorder these major phases:
1. docs and boundaries
2. Bun foundations
3. shared state/health modules
4. explicit job queue
5. backend abstraction
6. explicit result handoff
7. supervisor Bun core
8. shared command handlers
9. queue resilience
10. cloud seams
11. CI/docs hardening
12. real VM integration

## Suggested checkpoints

After Task 4:
- queue contract stable
- no more ad-hoc job JSON writes in entrypoints

After Task 6:
- queue/bot layers no longer scrape tmux directly
- only tmux backend knows how result extraction works

After Task 7:
- Bash no longer owns runtime state machine
- Bun owns core runtime behavior

After Task 10:
- local filesystem/tmux implementation is one backend, not whole architecture

## Success criteria

Refactor complete when all are true:
- Bash limited to bootstrap + wrappers + host integration
- Bun modules own runtime logic, queue logic, health logic, and transport handlers
- explicit result channel exists and is the contract above backend layer
- gateway and Telegram bot share runtime command modules
- queue supports lease/recovery semantics
- smoke tests pass locally
- real VM checklist passes
- Telegram live flow still works end-to-end
- codebase is easier to port to non-tmux backend without rewriting transports
