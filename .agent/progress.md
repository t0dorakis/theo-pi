# Agent Progress

## Current objective
- Move self-healing Pi worker plan from docs into a usable shell-first supervisor implementation and automate as much verification as possible inside repo.

## Latest completed work
- Implemented `scripts/vm/pi-worker-supervisor` with `start`, `status`, `restart`, `stop`, `checkpoint`, `verify`, `tail-logs`, and internal background supervisor loop.
- Added `~/.pi-worker/` state flow: `state.json`, `heartbeat.json`, `health.json`, `bootstrap-version`, `supervisor.log`, per-session metadata under `sessions/`, and checkpoint metadata under `checkpoints/`.
- Added wrapper commands: `scripts/vm/pi-worker-start`, `pi-worker-status`, `pi-worker-restart`, `pi-worker-stop`, `pi-worker-checkpoint`, `pi-worker-tail-logs`, `pi-worker-verify-runtime`.
- Added `scripts/vm/pi-worker-fail-inject` for `kill`, `stale`, `break-workspace`, and `restore-workspace` failure injection.
- Added `scripts/vm/pi-worker-runtime-checklist` for real-session runtime verification against the supervised-runtime checklist.
- Added `scripts/vm/pi-worker-supervisor-smoke-test` for temp-HOME failure-injection verification.
- Updated bootstrap script to create runtime dirs and install/symlink worker commands into `~/bin`.
- Updated verify script and README for new supervisor command surface.
- Added `.agent/commit-plan.md` to split current repo state into coherent commits after real-VM verification.
- Installed OrbStack locally, created Ubuntu 24.04 machine `theo-pi`, bootstrapped the VM, installed `pi`, and ran the real runtime checklist successfully.
- Tuned supervisor crash detection so monitoring cadence is independent from heartbeat write interval.

## Verification
- `bash -n` passed for new/changed worker shell scripts.
- Temp-HOME smoke tests passed with fake `pi` binary for:
  - `start`
  - `status --json`
  - killed-worker recovery via `kill -KILL <pid>`
  - stale heartbeat injection
  - broken workspace -> failed health
  - restore workspace + `restart`
  - `stop`
  - `checkpoint`
  - `verify`
  - `tail-logs`
- `scripts/vm/pi-worker-runtime-checklist demo` passed in temp-HOME with fake `pi`.
- Real VM check passed via `orbctl run -m theo-pi bash -lc '~/bin/pi-worker-runtime-checklist theo-pi'`.
- Confirmed status JSON transitions through `running`, `stale`, `failed`, and `stopped`, with heartbeat and restart count updating.
- Found and fixed multiple implementation bugs during verification:
  - JSON null handling with `jq --argjson`
  - empty state files from jq `select(length > 0)` suppressing whole object
  - stale stopped-state note caused by missing supervisor PID after stop
  - slow smoke-test recovery due to long heartbeat interval
  - GNU `date -d` portability gap; now uses `python3` timestamp parsing fallback
  - smoke-test kill semantics needed `SIGKILL` for deterministic fake-process failure injection
  - real VM exposed crash-recovery latency because process checks were tied to heartbeat interval; fixed by adding separate monitor cadence

## Next best step
- Curate and stage current dirty repo state according to `.agent/commit-plan.md`, keeping `research_task_loop/` out of worker commits, then create coherent commits.

## Blockers
- Repo already dirty, so commit steps still need deliberate staging to avoid bundling unrelated changes.
