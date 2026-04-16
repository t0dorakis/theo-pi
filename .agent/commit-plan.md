# Commit Plan

## Goal
Split current repo state into coherent commits once real-VM verification is done or intentionally deferred.

## Commit 1 — docs: add supervised pi worker architecture and specs

Include:
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`
- `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`
- `docs/plans/2026-04-14-clawrun-lessons-for-self-healing-pi-worker.md`
- `docs/plans/2026-04-14-open-agents-vs-clawrun-for-self-healing-pi-worker.md`
- `docs/plans/2026-04-14-supervised-pi-runtime-adr.md`
- `docs/plans/2026-04-14-pi-worker-runtime-state-layout.md`
- `docs/plans/2026-04-14-pi-worker-supervisor-spec.md`
- `docs/plans/2026-04-14-pi-worker-health-contract.md`
- `docs/plans/2026-04-14-pi-worker-workspace-execution-interface.md`
- `docs/plans/2026-04-14-pi-worker-gateway-and-wake-hooks.md`
- `docs/plans/2026-04-14-pi-worker-supervised-runtime-verification.md`
- optionally related existing doc updates already in diff

Suggested message:
- `docs: add supervised pi worker architecture and runtime specs`

## Commit 2 — feat: add shell-first pi worker supervisor tooling

Include:
- `scripts/vm/pi-worker-supervisor`
- `scripts/vm/pi-worker-start`
- `scripts/vm/pi-worker-status`
- `scripts/vm/pi-worker-restart`
- `scripts/vm/pi-worker-stop`
- `scripts/vm/pi-worker-checkpoint`
- `scripts/vm/pi-worker-tail-logs`
- `scripts/vm/pi-worker-verify-runtime`
- `scripts/vm/pi-worker-fail-inject`
- `scripts/vm/pi-worker-runtime-checklist`
- `scripts/vm/pi-worker-supervisor-smoke-test`
- `scripts/vm/pi-worker-verify.sh`
- `scripts/vm/bootstrap-ubuntu-pi-worker.sh`
- `README.md`

Suggested message:
- `feat: add shell-first pi worker supervisor tooling`

## Commit 3 — chore: track agent progress artifacts

Include:
- `.agent/tasks.json`
- `.agent/progress.md`
- `.agent/commit-plan.md`
- possibly `AGENTS.md` if intended to keep repo-local autonomy rules in git

Suggested message:
- `chore: add agent progress tracking artifacts`

## Separate review required

### `package-lock.json`
Current diff appears to be legitimate repo metadata sync from the workspace package setup:
- root `version` and `license`
- `pi-caveman` workspace link
- `pi-auto-skills` / `pi-caveman` package metadata

Recommended handling:
- include only if you want repo package metadata reflected in lockfile now
- otherwise revert separately before commit staging

### `docs/plans/2026-04-14-open-agents-pi-dual-sandbox-implementation-plan.md`
Present but not part of supervisor implementation path.
Keep separate unless intentionally bundled with docs commit.

### `research_task_loop/`
This is an unrelated nested checkout / research artifact and should not be included in worker docs/tooling commits.
Recommended handling:
- leave untracked
- or add to `.git/info/exclude` locally if it is just a scratch area

## Blocked external validation

Still requires real VM before claiming full completion:
- run `pi-worker-runtime-checklist theo-pi`
- observe real `pi` process behavior under tmux
- tune readiness/restart semantics if needed

## Suggested tomorrow sequence

1. On real VM: run
   - `pi-worker-supervisor start theo-pi ~/workspaces/theo-pi`
   - `pi-worker-runtime-checklist theo-pi`
2. If checklist passes, review `package-lock.json` and unrelated docs.
3. Stage commits in order above.
4. Re-run:
   - `npm test --workspaces --if-present`
   - `bash -n $(find scripts -type f | tr '\n' ' ')`
