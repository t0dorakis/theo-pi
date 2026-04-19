# theo-pi

Monorepo for Pi packages and extensions.

## Packages

### `pi-auto-skills`
Hermes-style autonomous skill creation for Pi.

Location:
- `packages/pi-auto-skills`

### `pi-caveman`
Minimal caveman-mode extension for Pi.

Location:
- `packages/pi-caveman`

## Prerequisites

- [Pi](https://pi.dev) installed
- Node.js available for package dependencies/tests

## Install `pi-auto-skills`

### Easiest: install from GitHub

```bash
pi install https://github.com/t0dorakis/theo-pi
```

The repo root is configured as a Pi package and currently installs:

- `pi-auto-skills`
- `pi-caveman`

### From a local checkout

```bash
pi install /absolute/path/to/theo-pi
```

Example:

```bash
pi install /Users/theo/repos/theo-pi
```

You can still install the package directory directly if you prefer:

```bash
pi install /absolute/path/to/theo-pi/packages/pi-auto-skills
```

If you already installed it and want Pi to pick up local changes in a running session, use:

```text
/reload
```

## What `pi-auto-skills` does

- gives Pi autonomous procedural memory for reusable workflows
- nudges Pi to save and refine reusable workflows as skills
- stores auto-generated skills in `~/.agents/skills/auto/`
- can create, patch, and write supporting files for auto-managed skills
- keeps a manual override available if you ever want to force skill capture

## Verify installation

After installing, you can:

1. Start Pi in any repo
2. Run a realistic multi-step task
3. Check generated skills:

```bash
find ~/.agents/skills/auto -maxdepth 2 -name SKILL.md
```

## What `pi-caveman` does

- activates caveman full mode by loading canonical `packages/pi-caveman/SKILL.md`
- includes a reusable `packages/pi-caveman/APPEND_SYSTEM.md` starter for fresh Pi installs
- keeps code blocks, commands, file paths, and exact error text unchanged
- stays intentionally minimal: only full mode, no lite/ultra toggles

## Manual override

If you ever want to force immediate capture of the current workflow, the package also provides:

```text
/autoskill-now
```

## Personal Pi worker VM artifacts

For Theo's local Linux VM worker setup, repo includes:

- `scripts/vm/bootstrap-ubuntu-pi-worker.sh` — base Ubuntu packages + Node + Pi + directories, plus `~/bin` command wrappers
- `scripts/vm/install-theo-pi-worker.sh` — clone/update repo in guest and configure Pi packages
- `scripts/vm/pi-worker-supervisor` — lightweight supervisor with `start/status/restart/stop/checkpoint/verify/tail-logs` commands and `~/.pi-worker/` state files
- `scripts/vm/pi-worker-start` — compatibility wrapper for `pi-worker-supervisor start`
- `scripts/vm/pi-worker-status` — compatibility wrapper for `pi-worker-supervisor status`
- `scripts/vm/pi-worker-restart` — compatibility wrapper for `pi-worker-supervisor restart`
- `scripts/vm/pi-worker-stop` — compatibility wrapper for `pi-worker-supervisor stop`
- `scripts/vm/pi-worker-checkpoint` — compatibility wrapper for `pi-worker-supervisor checkpoint`
- `scripts/vm/pi-worker-tail-logs` — compatibility wrapper for `pi-worker-supervisor tail-logs`
- `scripts/vm/pi-worker-verify-runtime` — compatibility wrapper for `pi-worker-supervisor verify`
- `scripts/vm/pi-worker-fail-inject` — helper for runtime failure injection (`kill`, `stale`, `break-workspace`, `restore-workspace`)
- `scripts/vm/pi-worker-runtime-checklist` — run supervised-runtime verification checks against a real session
- `scripts/vm/pi-worker-delegate` — send a prompt into a live tmux-backed Pi session
- `scripts/vm/pi-worker-gateway` / `pi-worker-gateway.ts` — Bun HTTP gateway with `/health`, `/status`, `/run`, `/restart`, `/checkpoint`, `/logs`, and Telegram webhook support
- `scripts/vm/pi-worker-telegram-bot` / `pi-worker-telegram-bot.ts` — Bun long-poll Telegram bot; plain text runs prompts, shows typing status, and returns final Pi answer; control commands stay available
- `scripts/vm/pi-worker-submit-job` / `pi-worker-run-job` — file-backed Telegram job queue + answer relay helpers under `~/.pi-worker/telegram/jobs`
- `scripts/vm/pi-worker-verify.sh` — verify guest worker prerequisites/config
- `scripts/vm/pi-worker-supervisor-smoke-test` — temp-HOME smoke test for supervisor start/status/kill/restart/stop behavior
- `scripts/vm/pi-worker-gateway-smoke-test` — temp-HOME smoke test for Bun gateway endpoints
- `templates/pi-worker/` — starter `settings.json`, `.env`, and SSH hardening snippets
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-bootstrap-checklist.md` — step-by-step bootstrap checklist

## Development

Install workspace dependencies:

```bash
cd /Users/theo/repos/theo-pi
npm install
```

Run package tests:

```bash
cd /Users/theo/repos/theo-pi/packages/pi-auto-skills
npm test
```

Smoke-load the caveman extension module:

```bash
cd /Users/theo/repos/theo-pi
npx tsx packages/pi-caveman/extensions/caveman.ts
```

Install the packaged global prompt starter for a fresh Pi agent:

```bash
mkdir -p ~/.pi/agent
cp /Users/theo/repos/theo-pi/packages/pi-caveman/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```
