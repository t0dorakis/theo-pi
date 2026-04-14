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

echo "==> Writing ~/.pi/agent/settings.json"
mkdir -p "$HOME/.pi/agent"
cat > "$HOME/.pi/agent/settings.json" <<EOF
{
  "packages": [
    "../../workspaces/theo-pi/packages/pi-auto-skills",
    "../../workspaces/theo-pi/packages/pi-caveman",
    "npm:pi-web-access"
  ]
}
EOF

echo "==> Installing pi-web-access package reference if needed"
pi install npm:pi-web-access || true

echo "==> Installing caveman prompt starter"
cp "$REPO_DIR/packages/pi-caveman/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"

echo "Done. Start Pi in repo and run /reload if session already open."
