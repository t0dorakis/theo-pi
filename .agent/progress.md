# Agent Progress

## Current objective
- Complete VM dogfood review and harden ACP dogfood delegation findings.

## Latest completed work
- Committed ACP-compatible VM delegation adapter: `420736f feat: expose pi worker as acp dogfood agent`.
- Ran branch reviews from VM via `scripts/vm/pi-worker-acp` using synced workspace and diff file.
- Fixed first review findings:
  - prompt shell-injection risk via temp-file prompt transport
  - silent failed-job UX via explicit `Worker job failed: ...` terminal text
  - queued-cancel race via cancel-before-start guard
  - wrapper exit status based on real queue status
- Fixed second review findings:
  - event seq now continues from existing NDJSON file after logger/runner recreation
  - partial streamed failures now append visible failure text
  - job-id path traversal rejected in gateway job/event/cancel routes
  - chat reset cancellation includes pending same-chat jobs
  - retry after partial output is skipped to avoid mixed stale/retry text
- Remaining known issue: event polling is O(total log) per poll; accepted as follow-up scalability work.

## Verification
- `bash -n scripts/vm/pi-worker-acp`
- `npm run check`
- `npm run check:ts`
- `bun test scripts/vm/lib/acpx-event-log.test.ts scripts/vm/lib/worker-runner.test.ts scripts/vm/lib/acpx/runtime-adapter-persistent.test.ts scripts/vm/lib/acpx/runtime-adapter-oneshot.test.ts`
- `npm run test:acp-adapter`
- `npm run test:vm`
- VM wrapper smoke after restart: `PI_WORKER_ACP_CHAT_ID=acp-envtest4 bash scripts/vm/pi-worker-acp "Reply exactly: status ok"`
- VM prompt-injection smoke: `PI_WORKER_ACP_CHAT_ID=acp-injection-test ... EOF_PROMPT ...`
- VM time-boxed reviews: `acp-review-b949a66`, `acp-review-2881ae3`

## Next best step
- Sync final `291a02b` changes to VM and optionally run one last short VM review/smoke.

## Blockers
- None.
