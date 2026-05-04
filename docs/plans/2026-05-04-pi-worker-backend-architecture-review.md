# Pi Worker Backend Architecture Review

**Date:** 2026-05-04  
**Branch:** `feat/acpx-backend`  
**Scope:** Review current pi-worker backend architecture after acpx/smolvm additions.  
**Reviewer note:** No Codex used.

## Executive summary

The worker backend layer has drifted from a focused runtime into three partially overlapping execution strategies:

1. `tmux` — original proven-but-fragile pane automation backend.
2. `acpx` — new ACP/runtime backend, architecturally better direction.
3. `smolvm` — unproven VM backend, currently broken at typecheck.

Recommendation: simplify aggressively.

- **Keep and harden `acpx` as the only execution backend.**
- **Remove `smolvm` now.** It is not proven and does not compile.
- **Remove `tmux` after one short acpx validation gate.** Keeping it as fallback preserves complexity and makes every path harder to reason about.
- **Collapse backend abstraction if acpx becomes sole backend.** Replace generic backend registry with an `AcpxWorkerRuntime` / `WorkerRunner` module that owns sessions, results, and queue state transitions.

## Why acpx was introduced

The original tmux worker solved bootstrapping, but its integration model is inherently fragile:

- It sends prompts into an interactive terminal session.
- It requires an XML final-answer wrapper to delimit output.
- It scrapes terminal pane text.
- It cannot reliably represent structured tool events, thinking, usage, errors, cancellation, or session lifecycle.
- Telegram and gateway behavior depend on prompt discipline instead of protocol guarantees.

acpx was introduced to replace terminal scraping with ACP:

- typed event stream instead of pane capture
- explicit sessions instead of prompt-history accidents
- agent-agnostic runtime interface
- cleaner path to streaming Telegram updates
- cleaner cancellation and failure reporting
- future ability to route Pi/Codex/Claude/Gemini behind same ACP shape

This is the right architectural direction. The current implementation is not yet integrated deeply enough.

## Current architecture problems

### 1. Backend selection is duplicated

Backend selection now exists in multiple places:

- `scripts/vm/lib/backend-registry.ts`
- `scripts/vm/pi-worker-run-job.ts`
- `scripts/vm/pi-worker-gateway.ts`
- `scripts/vm/lib/env.ts`

`backend-registry.ts` is the intended factory, but `pi-worker-run-job.ts` manually reimplements selection. Gateway ignores it entirely and still constructs tmux directly.

Impact:

- Adding/removing a backend requires edits in multiple places.
- Gateway and runner can disagree about active backend.
- Tests can pass for one path while production uses another.

### 2. Gateway still bypasses the queue/runtime path

`pi-worker-gateway.ts` still uses tmux directly:

- health uses `createTmuxBackend(...)`
- `/run` calls `pi-worker-delegate`
- Telegram webhook `/run` also delegates into tmux

This means setting `PI_WORKER_BACKEND=acpx` does not fully switch the system. The gateway remains a hidden tmux entrypoint.

Impact:

- Operational behavior depends on entrypoint.
- acpx can appear “enabled” while gateway still uses tmux.
- Removing tmux requires fixing gateway first.

### 3. Queue status and result-channel state are split

There are two state layers:

- queue jobs: `pending | running | done | failed`
- result-channel records: `done | failed`

Backends write result-channel files. `pi-worker-run-job.ts` polls/reads them and updates queue state. But failed backend results can throw during `readResult()` without being caught and converted into `queue.failJob(...)`.

Impact:

- Jobs can remain `running` forever.
- Telegram can keep typing instead of delivering failure.
- Operators have to inspect result files manually.

### 4. Backend interface encodes two incompatible execution models

`WorkerBackend.submitPrompt()` currently means different things:

- tmux: fire-and-poll; returns after dispatching prompt.
- acpx/smolvm: blocking execution; returns after full job finishes.

The interface documentation acknowledges this, but callers still need special handling. This is a sign the abstraction is too shallow.

If acpx becomes sole backend, remove this abstraction. The runner should expose one clear operation:

```ts
runJob(job): Promise<{ status: "done"; answer: string } | { status: "failed"; error: string }>
```

### 5. Session concepts are overloaded

The codebase now has several unrelated “session” meanings:

- tmux session name
- acpx persistent session key
- Telegram chat/session continuity
- future VM instance/session

These are mixed through generic `session` and backend-specific config. This increases coupling and makes future persistence/cancellation harder.

acpx-only architecture should rename concepts explicitly:

- `workerName`
- `chatId`
- `acpxSessionKey`
- `jobId`

### 6. smolvm is broken and unproven

Current `smolvm` backend imports a missing module:

```ts
import { buildGuestPiCommand, createSmolVmManager, type SmolVmConfig } from "../smolvm"
```

`npm run check:ts` fails because `scripts/vm/lib/smolvm.ts` does not exist.

Beyond compilation, smolvm has no live proof:

- no proven VM boot path in this branch
- no proven SSH auth/config path
- no proven Pi install/run path inside guest
- tests mock all external behavior

Impact:

- Breaks typecheck.
- Adds large env/config surface.
- Distracts from acpx hardening.

## Recommendation: kill both smolvm and tmux

### Kill smolvm immediately

Remove from this PR before merge:

- `scripts/vm/lib/backends/smolvm-backend.ts`
- `scripts/vm/lib/backends/smolvm-backend.test.ts`
- `smolvm` from `WorkerBackendId`
- `SmolVmConfig` from env
- `smolvm` branch in backend registry / runner
- any `SMOLVM_*` env docs introduced by this branch
- AppleDouble files: `scripts/vm/lib/backends/._*`

Rationale: it is broken, unproven, and not required for acpx validation.

### Kill tmux after acpx validation gate

tmux has been useful as a bootstrap mechanism, but retaining it now makes the system permanently bifurcated.

Reasons to remove:

- It forces lowest-common-denominator backend abstractions.
- It keeps XML delimiter hacks alive.
- It makes gateway/Telegram behavior inconsistent.
- It prevents clear ownership of sessions/cancel/results.
- It adds operational fallback that can silently hide acpx regressions.

The only reason to keep tmux is rollback. Prefer a git rollback or tagged release instead of carrying two runtime architectures in one code path.

## Proposed target architecture

Make acpx the runtime, not “one backend among several.”

```txt
Telegram bot / Gateway / CLI
          |
          v
      JobQueue
          |
          v
   pi-worker-run-job
          |
          v
   AcpxWorkerRuntime
      |        |
      |        +-- AcpxSessionManager
      |        +-- AcpxEventCollector
      |        +-- ResultChannel writer
      |
      v
   Queue complete/fail
```

Key rules:

1. All user work enters through `JobQueue`.
2. Only `pi-worker-run-job` executes jobs.
3. Gateway `/run` enqueues a job or triggers `pi-worker-run-job`; it never calls a backend directly.
4. Telegram bot only enqueues, drains, and delivers queue results.
5. acpx runtime owns sessions and event collection.
6. Queue state is authoritative for user-visible job lifecycle.
7. Result-channel is diagnostic/artifact storage, not lifecycle authority.

## Proposed module shape

Replace generic backend modules with focused acpx runtime modules:

```txt
scripts/vm/lib/acpx/
  runtime.ts          # create runtime, run one job, collect answer/events
  sessions.ts         # session keying, lock, TTL/reset later
  events.ts           # event -> answer/tool/thought summaries
  errors.ts           # normalize AcpRuntimeError/result failures

scripts/vm/lib/worker-runner.ts
  runQueuedJob(jobId, env) # claim, write request, run acpx, complete/fail
```

Public interface:

```ts
type WorkerRunResult =
  | { status: "done"; answer: string }
  | { status: "failed"; error: string }

async function runAcpxJob(job: WorkerJob, env: RuntimeEnv): Promise<WorkerRunResult>
```

This is deeper than current `WorkerBackend`: small interface, hides acpx sessions, streaming, retries, and result-channel writes.

## Migration plan

### Step 1 — delete unproven backend code

- Remove smolvm backend/config/tests.
- Remove AppleDouble files.
- Run `npm run check:ts`.

Exit criterion: typecheck no longer fails because of missing smolvm module.

### Step 2 — make acpx dependency committed and documented

- Keep `acpx` pinned in `package.json` and `package-lock.json`.
- Bootstrap installs same pinned version if global CLI is still needed.
- Docs must say code uses `acpx/runtime`, not old `acpx exec` path.

Exit criterion: fresh install can import `acpx/runtime`.

### Step 3 — route gateway through queue

Change gateway `/run` and Telegram webhook behavior:

- enqueue job with `createJobQueue(...)`
- return job id / accepted response
- do not call `pi-worker-delegate`
- health should report acpx runtime health, not tmux health

Exit criterion: no gateway code imports `createTmuxBackend` or calls `pi-worker-delegate`.

### Step 4 — replace backend abstraction with acpx runner

- Remove `WorkerBackendId` union if acpx is sole backend.
- Remove `backend-registry.ts`.
- Implement `runAcpxJob(...)` returning explicit done/failed result.
- `pi-worker-run-job.ts` owns queue status transitions in `try/catch`.

Exit criterion: no code branches on `PI_WORKER_BACKEND` for execution.

### Step 5 — remove tmux runtime path

Delete or archive:

- `scripts/vm/lib/backends/tmux-backend.ts`
- tmux backend tests
- `pi-worker-delegate`
- tmux-specific final-answer extraction tests
- tmux-only supervisor assumptions, or rewrite supervisor to supervise worker/gateway only
- tmux env/docs (`PI_WORKER_SESSION` only if still needed as worker name)

Exit criterion: grep for `tmux`, `pi-worker-delegate`, `final_answer` shows only historical docs or migration notes.

### Step 6 — add real acpx smoke

Minimum smoke should prove the path that matters:

1. submit a job
2. run the job via `pi-worker-run-job`
3. assert queue job becomes `done`
4. assert result file exists
5. assert answer non-empty

Then add persistent chat smoke:

1. send first message in chat
2. send second message in same chat
3. verify second run uses same acpx session key

## Decision log

### Decision 1: acpx becomes canonical execution runtime

Reason: ACP is the correct boundary for agent execution. It removes terminal scraping and exposes typed events/session lifecycle.

### Decision 2: smolvm removed from worker backend layer

Reason: It is broken and unproven. VM orchestration can return later as infrastructure under acpx or deployment tooling, not as a second agent execution backend.

### Decision 3: tmux removed instead of kept as fallback

Reason: Fallback doubles architecture cost. Simpler system with one runtime is easier to test, debug, and evolve. Rollback should happen via git/release, not permanent dual execution paths.

### Decision 4: queue is lifecycle authority

Reason: Telegram/gateway users care about job status. Result files are artifacts. Runner must always convert runtime outcome into queue `done` or `failed`.

## Immediate trash list

High confidence deletions:

- `scripts/vm/lib/backends/smolvm-backend.ts`
- `scripts/vm/lib/backends/smolvm-backend.test.ts`
- `scripts/vm/lib/backends/._smolvm-backend.ts`
- `scripts/vm/lib/backends/._smolvm-backend.test.ts`
- `scripts/vm/lib/backends/._tmux-backend.ts`
- `scripts/vm/lib/backends/._tmux-backend.test.ts`

Delete after acpx smoke passes:

- `scripts/vm/lib/backends/tmux-backend.ts`
- `scripts/vm/lib/backends/tmux-backend.test.ts`
- `scripts/vm/pi-worker-delegate`
- tmux-specific health/check/restart paths
- XML final-answer prompting/extraction

Review/rewrite instead of delete:

- `scripts/vm/pi-worker-run-job.ts`
- `scripts/vm/pi-worker-gateway.ts`
- `scripts/vm/pi-worker-telegram-bot.ts`
- `scripts/vm/lib/env.ts`
- `templates/pi-worker/env.pi.example`
- README worker docs

## Final recommendation

Do not merge current branch as-is.

First merge should be an acpx-only simplification PR:

- remove smolvm
- remove backend-selection duplication
- route gateway through queue
- make acpx the only runtime path
- add one real acpx smoke

Then a second PR can remove tmux-specific supervisor/delegate leftovers once the acpx path is proven on the VM.
