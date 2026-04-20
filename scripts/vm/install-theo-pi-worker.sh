#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$HOME/workspaces/theo-pi}"
REPO_URL="${REPO_URL:-git@github.com:t0dorakis/theo-pi.git}"

mkdir -p "$(dirname "$REPO_DIR")"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "==> Cloning $REPO_URL -> $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
else
  echo "==> Repo exists. Pulling latest in $REPO_DIR"
  git -C "$REPO_DIR" pull --ff-only
fi

echo "==> Installing workspace dependencies"
cd "$REPO_DIR"
npm install

echo "==> Symlinking ~/.pi/agent/settings.json -> repo .pi/settings.json"
mkdir -p "$HOME/.pi/agent"
ln -sf "$REPO_DIR/.pi/settings.json" "$HOME/.pi/agent/settings.json"

echo "==> Installing caveman prompt starter"
cp "$REPO_DIR/packages/pi-caveman/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"

echo "Done. Start Pi in repo and run /reload if session already open."
