# Agent Progress

## Current objective
- Commit ACP-compatible VM delegation adapter and review branch through the VM dogfood path.

## Latest completed work
- Added ACP-compatible stdio adapter for theo-pi VM delegation.
- Added gateway job event polling and cancel endpoints for ACP adapter streaming/cancel.
- Added `scripts/vm/pi-worker-acp` dogfood wrapper with token provisioning, gateway restart, stable chat id, result retrieval, cancel, and status commands.
- Disabled incomplete ACP tool-call mapping for now; text-only streaming avoids invalid ACP updates during long reviews.
- Added `npm run test:acp-adapter` and `npm run worker:acp`.
- Updated docs/README for ACP adapter and dogfood workflow.

## Verification
- `npm run check`
- `npm run check:ts`
- `npm run test:acp-adapter`
- `npm run test:vm`
- VM wrapper smoke: `bash scripts/vm/pi-worker-acp "Reply exactly: fixed chat ok"`
- VM result retrieval: `bash scripts/vm/pi-worker-acp result`

## Next best step
- Commit current branch, sync to VM, then request full branch review from the VM via `scripts/vm/pi-worker-acp`.

## Blockers
- None.
