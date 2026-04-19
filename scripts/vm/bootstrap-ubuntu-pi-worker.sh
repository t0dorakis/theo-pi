#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run as normal user, not root. Script uses sudo when needed."
  exit 1
fi

echo "==> Updating apt"
sudo apt update
sudo apt upgrade -y

echo "==> Installing base packages"
sudo apt install -y \
  git curl tmux build-essential ripgrep fd-find jq gh unzip zip ca-certificates gnupg

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "==> Node already installed: $(node -v)"
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "==> Installing pi-coding-agent"
  npm install -g @mariozechner/pi-coding-agent
else
  echo "==> Pi already installed: $(pi --version || true)"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "==> Installing Bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
else
  echo "==> Bun already installed: $(bun --version)"
fi

echo "==> Creating worker directories"
mkdir -p "$HOME/workspaces" "$HOME/logs" "$HOME/bin" "$HOME/.pi/agent" "$HOME/.agents/skills" "$HOME/.pi-worker/checkpoints" "$HOME/.pi-worker/sessions"

if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
  if [[ -f "$HOME/.bashrc" ]]; then
    if ! grep -Fq 'export PATH="$HOME/bin:$PATH"' "$HOME/.bashrc"; then
      printf '\nexport PATH="$HOME/bin:$PATH"\n' >> "$HOME/.bashrc"
    fi
  fi
fi

if [[ ! -f "$HOME/.tmux.conf" ]]; then
  cat > "$HOME/.tmux.conf" <<'EOF'
set -g mouse on
set -g history-limit 100000
EOF
fi

if [[ ! -f "$HOME/.env.pi" ]]; then
  cat > "$HOME/.env.pi" <<'EOF'
# Fill only keys needed in this VM.
# chmod 600 ~/.env.pi
# export ANTHROPIC_API_KEY="..."
# export OPENAI_API_KEY="..."
# export GEMINI_API_KEY="..."
EOF
  chmod 600 "$HOME/.env.pi"
fi

echo "==> Versions"
node -v
npm -v
pi --version || true
tmux -V
git --version

echo "==> Installing local worker command wrappers into ~/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for cmd in pi-worker-supervisor pi-worker-start pi-worker-status pi-worker-restart pi-worker-stop pi-worker-checkpoint pi-worker-tail-logs pi-worker-verify-runtime pi-worker-fail-inject pi-worker-runtime-checklist pi-worker-delegate pi-worker-submit-job pi-worker-run-job pi-worker-gateway pi-worker-telegram-bot pi-worker-verify.sh pi-worker-supervisor-smoke-test pi-worker-gateway-smoke-test; do
  ln -sf "$SCRIPT_DIR/$cmd" "$HOME/bin/$cmd"
done
chmod +x "$SCRIPT_DIR"/pi-worker-supervisor "$SCRIPT_DIR"/pi-worker-start "$SCRIPT_DIR"/pi-worker-status "$SCRIPT_DIR"/pi-worker-restart "$SCRIPT_DIR"/pi-worker-stop "$SCRIPT_DIR"/pi-worker-checkpoint "$SCRIPT_DIR"/pi-worker-tail-logs "$SCRIPT_DIR"/pi-worker-verify-runtime "$SCRIPT_DIR"/pi-worker-fail-inject "$SCRIPT_DIR"/pi-worker-runtime-checklist "$SCRIPT_DIR"/pi-worker-delegate "$SCRIPT_DIR"/pi-worker-submit-job "$SCRIPT_DIR"/pi-worker-run-job "$SCRIPT_DIR"/pi-worker-gateway "$SCRIPT_DIR"/pi-worker-telegram-bot "$SCRIPT_DIR"/pi-worker-verify.sh "$SCRIPT_DIR"/pi-worker-supervisor-smoke-test "$SCRIPT_DIR"/pi-worker-gateway-smoke-test "$SCRIPT_DIR"/pi-worker-gateway.ts "$SCRIPT_DIR"/pi-worker-telegram-bot.ts "$SCRIPT_DIR"/pi-worker-submit-job.ts "$SCRIPT_DIR"/pi-worker-run-job.ts

if [[ ! -f "$HOME/.pi-worker/bootstrap-version" ]]; then
  printf '2026-04-15.1\n' > "$HOME/.pi-worker/bootstrap-version"
fi

echo "Done. Next: clone repos into ~/workspaces, install Pi packages, configure SSH/Tailscale."
