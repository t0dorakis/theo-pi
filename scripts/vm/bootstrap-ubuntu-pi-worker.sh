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

echo "==> Creating worker directories"
mkdir -p "$HOME/workspaces" "$HOME/logs" "$HOME/bin" "$HOME/.pi/agent" "$HOME/.agents/skills"

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

echo "Done. Next: clone repos into ~/workspaces, install Pi packages, configure SSH/Tailscale."
