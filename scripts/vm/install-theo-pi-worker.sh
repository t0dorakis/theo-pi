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

echo "==> Writing ~/.pi/agent/settings.json with absolute repo package paths"
mkdir -p "$HOME/.pi/agent"
python3 - "$REPO_DIR" "$HOME/.pi/agent/settings.json" <<'PY'
import json
import sys
from pathlib import Path
repo = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2])
source = repo / ".pi/settings.json"
settings = json.loads(source.read_text())
packages = []
for package in settings.get("packages", []):
    if not isinstance(package, str):
        packages.append(package)
    elif package.startswith("npm:"):
        packages.append(package)
    elif package.startswith("./"):
        packages.append(str((repo / package[2:]).resolve()))
    elif package.startswith("../"):
        packages.append(str((repo / package).resolve()))
    else:
        packages.append(package)
settings["packages"] = packages
out.write_text(json.dumps(settings, indent=2) + "\n")
PY

echo "==> Installing caveman prompt starter"
cp "$REPO_DIR/packages/pi-caveman/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"

echo "Done. Start Pi in repo and run /reload if session already open."
