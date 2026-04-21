# Telegram Polling Bot Notes

Minimal first remote-control layer for the supervised Pi worker.

## Commands

- `/run <prompt>` — send prompt into live Pi tmux session
- `/status` — show worker health JSON
- `/restart` — restart supervised session
- `/logs` — tail supervisor logs
- `/checkpoint [label]` — create checkpoint metadata
- `/help` — command summary

## Required environment

```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_ALLOWED_CHAT_IDS="123456789"
export PI_WORKER_SESSION="theo-pi"
```

## Run

```bash
node ~/workspaces/theo-pi/scripts/vm/pi-worker-telegram-bot.mjs
```

## Design choices

- long polling first, not webhooks
- local bridge uses existing worker commands plus `pi-worker-delegate`
- allowlist required; bot exits if not configured
- bot sends acknowledgement only, not full streamed Pi output

## SmolVM spike variant

Use isolated wrapper plus separate bot token:

```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_ALLOWED_CHAT_IDS="123456789"
export PI_WORKER_BACKEND="smolvm"
export PI_WORKER_STATE_DIR="$HOME/.pi-worker-smolvm"
export SMOLVM_BIN="/absolute/path/to/smolvm"
export SMOLVM_HOST_PI_AUTH_PATH="$HOME/.config/pi/auth.json"
scripts/vm/pi-worker-telegram-bot-smolvm
```

Notes:
- wrapper sets `PI_WORKER_BACKEND=smolvm` and isolated state dir by default
- backend uses guest-local workspace only
- guest Pi calls close stdin automatically to avoid hanging over SSH transport

## Future upgrades

- safer task/result correlation
- `/session` command for multiple workers
- webhook mode behind local HTTP gateway
- chunked result capture from tmux output
