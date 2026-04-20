# Agent Progress

## Current objective
- Validate SmolVM as backend for existing Telegram Pi bot flow using a separate bot token and guest-local Pi runtime.

## Latest completed work
- Confirmed local duplicate `task_loop_tasks` issue was only stale local Pi config, not VM config.
- Verified VM Pi package activation and always-on package set.
- Cloned `external/SmolVM` and completed deep architecture review.
- Wrote analysis doc: `docs/plans/2026-04-19-smolvm-architecture-analysis.md`
  - mapped SDK/CLI/orchestrator/runtime/storage/network/image/browser/dashboard layers
  - documented Firecracker vs QEMU vs libkrun paths
  - called out writable-workspace mismatch, SSH trust model, host-network mutation, and best spike seam for Theo Pi
- Ran isolated local SmolVM spike on branch `spike/smolvm-pi-local-sandbox`:
  - installed SmolVM in local venv and Homebrew QEMU
  - booted Ubuntu sandbox locally
  - verified shell command execution works
  - installed newer Node + Pi CLI in larger 8 GiB guest
  - verified `pi --help` works in guest
  - investigated guest `pi -p` hang further and found transport-level workaround:
    - `pi -p ...` over SmolVM/Paramiko hung when stdin stayed attached
    - `pi -p ... </dev/null` exited immediately and revealed actual provider/auth error (`No API key found for unknown`)
  - verified real authenticated guest one-shot works after copying local Pi auth + settings into guest and running:
    - `pi --provider openai-codex --model gpt-5.4 -p ... </dev/null`
  - proved cleaner guest-native path too:
    - minimal guest `settings.json` with default provider/model
    - copied only `auth.json`
    - `pi list` showed `No packages installed.`
    - one-shot prompt still worked
    - Pi successfully read and edited local files and a tiny git repo inside guest
  - confirmed workspace mount still fails due missing guest 9p/overlay support
  - confirmed QEMU cleanup was more reliable via CLI delete than context-manager stop

## Verification
- `smolvm doctor --backend qemu`
- `python examples/quickstart_sandbox.py`
- live guest checks for OS/packages/disk/node/npm/pi CLI inside sandbox
- `pi -p ... </dev/null` inside guest to confirm hang cause vs actual Pi error
- manual cleanup via `smolvm delete <vm>` after failed stop paths

## Next best step
- Execute `docs/plans/2026-04-20-smolvm-telegram-spike-implementation-plan.md`: add selectable `smolvm` backend, isolated Telegram spike entrypoint, fake-backed smoke tests, then run one live Telegram round-trip against a real SmolVM guest.

## Blockers
- None.
- Larger refactor plan still has unfinished Tasks 7-12 after merge point.
