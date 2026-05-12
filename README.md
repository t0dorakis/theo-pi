# theo-pi

Monorepo for Pi packages and extensions.

## Agent skills

### `autobrowse-agent-browser`

Self-improving browser workflow skill backed by `agent-browser` and ACPX.

Install with `skills.sh` / `skills` CLI:

```bash
npx skills add https://github.com/t0dorakis/theo-pi --skill autobrowse-agent-browser
```

Location:
- `skills/autobrowse-agent-browser`

## Packages

### `pi-auto-skills`
Hermes-style autonomous skill creation for Pi.

Location:
- `packages/pi-auto-skills`

### `pi-caveman`
Minimal caveman-mode extension for Pi.

Location:
- `packages/pi-caveman`

### `pi-task-loop`
Pi-native autonomous continuation loop for established repo tasks.

Location:
- `packages/pi-task-loop`

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
- `pi-task-loop`

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

## `pi-task-loop` quick use

```text
/task-loop on
/task-loop off
/task-loop once
/task-loop status
/task-loop interval 15m
/task-loop context focus on highest-value unfinished repo task first
```

Dogfood E2E:

```bash
cd /Users/theo/repos/theo-pi
npm run dogfood:e2e --workspace packages/pi-task-loop
```

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
- `scripts/vm/pi-worker-gateway` / `pi-worker-gateway.ts` — Bun HTTP gateway; `/run` enqueues non-Telegram queue jobs
- `scripts/vm/pi-worker-telegram-bot` / `pi-worker-telegram-bot.ts` — Telegram poller; commands enqueue numeric-chat jobs and handle control commands
- `scripts/vm/pi-worker-telegram-runner` / `pi-worker-telegram-runner.ts` — Telegram runner; claims numeric-chat jobs, sends typing, and delivers final answers
- `scripts/vm/pi-worker-submit-job` / `pi-worker-run-job` — file-backed job queue + ACPX runtime adapter under `~/.pi-worker/telegram/jobs`
- `scripts/vm/pi-worker-verify.sh` — verify guest worker prerequisites/config
- `scripts/vm/pi-worker-supervisor-smoke-test` — temp-HOME smoke test for supervisor start/status/kill/restart/stop behavior
- `scripts/vm/pi-worker-gateway-smoke-test` — temp-HOME smoke test for Bun gateway queue endpoints
- `scripts/vm/pi-worker-acpx-smoke-test` — repeatable real acpx smoke: enqueue job, run it, assert queue/result/ACP session state
- `scripts/vm/pi-worker-acp` — dogfood CLI for agent-to-VM delegation over ACPX (`run`, `result`, `cancel`, `status`)
- `scripts/vm/pi-worker-acp-stdio.ts` — ACP-compatible stdio adapter used by `acpx --agent`
- `templates/pi-worker/` — example `settings.json`, `.env`, and SSH hardening snippets; installer generates VM settings from repo `.pi/settings.json`

ACPX worker quick start:

```bash
npm install
npm install -g acpx@0.6.1 # optional CLI convenience; runtime imports local package
export ACPX_AGENT=pi
export ACPX_SESSION_MODE=persistent
export ACPX_CWD="$PWD"
./scripts/vm/pi-worker-supervisor start theo-pi "$PWD"
```

Dogfood delegation from host to VM:

```bash
bash scripts/vm/pi-worker-acp "review this branch"
bash scripts/vm/pi-worker-acp result
bash scripts/vm/pi-worker-acp cancel
```

The wrapper prints job id, chat id, status, and exact retrieval/cancel commands so an orchestrating agent does not need to infer queue internals.

Raw ACP adapter path:

```bash
THEO_PI_GATEWAY_URL=http://127.0.0.1:8787 \
THEO_PI_GATEWAY_TOKEN=... \
acpx --agent "bun scripts/vm/pi-worker-acp-stdio.ts" exec "review this branch"
```

Repeatable real smoke on configured machine/VM:

```bash
bash scripts/vm/pi-worker-acpx-smoke-test
# or from host into OrbStack VM
bash scripts/vm/pi-worker-instance smoke-acpx
```

Security notes:
- keep gateway bound to `127.0.0.1` unless you intentionally front it with a trusted tunnel/proxy
- set `PI_WORKER_GATEWAY_TOKEN`; gateway refuses to start without it
- set `TELEGRAM_WEBHOOK_SECRET` before exposing `/telegram/webhook`; requests must include `x-telegram-bot-api-secret-token`
- `TELEGRAM_ALLOWED_CHAT_IDS` limits bot actions by chat id, but does not replace webhook authentication
- `docs/plans/pi-worker-acpx-roadmap.md` — current pi-worker ACPX follow-up roadmap

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
