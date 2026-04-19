# Bun Gateway Notes

Full local control plane for the supervised Pi worker.

## Runtime

Use Bun for a small HTTP gateway layered on top of existing worker shell commands.

Launch:

```bash
bun ~/workspaces/theo-pi/scripts/vm/pi-worker-gateway.mjs
```

Or via wrapper:

```bash
~/bin/pi-worker-gateway
```

## Endpoints

### `GET /health`
Public health endpoint for local machine use.

### `GET /status`
Returns current worker status JSON.
Requires bearer auth when `PI_WORKER_GATEWAY_TOKEN` is set.

### `POST /run`
Body:

```json
{ "prompt": "do thing" }
```

Delegates prompt to live tmux-backed Pi session.

### `POST /restart`
Restarts supervised session.

### `POST /checkpoint`
Body optional:

```json
{ "label": "before-risky-change" }
```

### `GET /logs`
Returns recent supervisor logs.

### `POST /telegram/webhook`
Telegram webhook entry point. Reuses the same command handling as the polling bot.

## Environment

```bash
export PI_WORKER_SESSION="theo-pi"
export PI_WORKER_GATEWAY_HOST="127.0.0.1"
export PI_WORKER_GATEWAY_PORT="8787"
export PI_WORKER_GATEWAY_TOKEN="change-me"
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_ALLOWED_CHAT_IDS="123456789"
```

## Command model

Gateway stays thin:
- health via `pi-worker-status`
- prompt delegation via `pi-worker-delegate`
- restart via `pi-worker-restart`
- checkpoint via `pi-worker-checkpoint`
- logs via `pi-worker-tail-logs`

## Notes

- Long polling bot is still useful for the simplest no-webhook setup.
- Bun gateway is better base if you want Telegram webhooks or other future clients.
- Keep it local/private first; put a reverse proxy or tunnel in front later if needed.
