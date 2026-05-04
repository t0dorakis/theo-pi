# Agent Progress

## Current objective
- Simplify pi-worker to acpx-only execution path and keep OrbStack smoke fast/repeatable.

## Latest completed work
- Removed backend abstraction layer and deleted smolvm + tmux execution backends from worker runtime path.
- Added `scripts/vm/lib/worker-runner.ts` as acpx-only queue runner.
- Reworked gateway `/run` to enqueue jobs and drain non-Telegram queue jobs through a single logged runner instead of delegating to tmux or spawning unbounded runners.
- Replaced global acpx runner lock with per-session turn lock, added duplicate-running-job guard, stale lock cleanup, and lease heartbeats during acpx execution.
- Reworked submit/bot paths to stamp jobs as `acpx`; Telegram bot now skips non-numeric gateway jobs.
- Added `scripts/vm/lib/acpx-event-log.ts` and wired normalized ACPX events to `~/.pi-worker/jobs/events/<jobId>.ndjson`.
- Added AbortSignal timeout/cancel wiring for `runtime.startTurn`; timers are unref'd.
- Added `/reset` for gateway and Telegram through cancel markers plus `runtime.close({ discardPersistentState: true })`.
- Updated gateway smoke so `npm run test:vm` still exercises non-supervisor gateway endpoints without tmux; supervisor-only endpoints remain explicitly skipped.
- Fixed empty-answer state divergence by overwriting result-channel status to failed when worker-runner fails empty output.
- Avoided worker-runner clobbering existing backend result files in catch path.
- Added repeatable real smoke: `scripts/vm/pi-worker-acpx-smoke-test` plus host helper `scripts/vm/pi-worker-instance smoke-acpx`.
- Patched smoke/verify/bootstrap docs and wrappers for acpx-only path.
- Fixed OrbStack ACPX failures caused by placeholder exported API keys in `~/.env.pi`.
- Patched `pi-worker-instance` defaults to current OrbStack VM/repo path.

## Verification
- `npm run check`
- `npm run check:ts`
- `bun test scripts/vm/lib/worker-runner.test.ts scripts/vm/lib/backends/acpx-backend-oneshot.test.ts scripts/vm/lib/backends/acpx-backend-persistent.test.ts`
- `npm run test:vm` (local tmux-less environment now runs gateway health/run/job/reset-validation/numeric-chatId checks; supervisor-only checks skip)
- OrbStack sync: `bash scripts/vm/pi-worker-instance sync --restart all`
- OrbStack acpx smoke: `bash scripts/vm/pi-worker-instance smoke-acpx review-fixes` → both queued jobs done, answers correct, persistent session file reused
- OrbStack event log inspection showed `session_ready`, `status`, `text_delta`, and `turn_result` records for latest jobs.
- prior guest gateway smoke: `/run` queued job, `/jobs/<id>` returned `status: done`, result file answer `7`

## Next best step
- Continue Task 21: stream ACPX structured events to Telegram from the new event log/live runtime event path.

## Blockers
- Local host lacks `tmux`, so legacy supervisor/gateway temp-HOME smokes are skipped rather than exercised.
- Could not re-run gateway curl smoke in this session because guest `~/.env.pi` did not expose `PI_WORKER_GATEWAY_TOKEN` to non-interactive shell command.
- Full removal of tmux-based process management remains future cleanup; execution path is acpx-only.
