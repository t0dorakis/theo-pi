# Agent Progress

## Current objective
- Complete VM dogfood review and harden ACP dogfood delegation findings.

## Latest completed work
- Committed ACP-compatible VM delegation adapter: `420736f feat: expose pi worker as acp dogfood agent`.
- Ran full branch review from VM through `scripts/vm/pi-worker-acp`; review found prompt shell-injection risk, silent failed-job UX, queued-cancel race, and O(total-log) event polling.
- Fixed prompt shell-injection risk by pushing prompt as a temp file to the VM instead of interpolating it into remote shell source.
- Fixed failed-job UX by emitting `Worker job failed: ...` as ACP text and making wrapper check real queue status instead of assuming acpx exit code means success.
- Fixed queued-cancel race by checking cancel marker immediately after claim and before ACPX turn start.
- Added worker-runner regression test for cancel-before-start.
- Committed fixes: `173cbfb fix: harden acp dogfood delegation`.

## Verification
- `bash -n scripts/vm/pi-worker-acp`
- `npm run check`
- `npm run check:ts`
- `bun test scripts/vm/lib/worker-runner.test.ts`
- `npm run test:acp-adapter`
- `npm run test:vm`
- VM branch review via `PI_WORKER_ACP_CHAT_ID=acp-review-420736f PI_WORKER_ACP_TIMEOUT_SECONDS=1200 bash scripts/vm/pi-worker-acp ...`

## Next best step
- Recover/restart OrbStack `pi-worker` VM, then sync and re-run wrapper smoke/review for `173cbfb`.

## Blockers
- OrbStack `pi-worker` became stuck in `stopping` after a wrapper smoke attempt; `orbctl run` and `orbctl stop -f pi-worker` timed out locally.
