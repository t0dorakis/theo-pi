#!/usr/bin/env bash
set -euo pipefail

if [[ -f "$HOME/.env.pi" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.env.pi"
fi

pass() { printf '[pass] %s\n' "$1"; }
fail() { printf '[fail] %s\n' "$1"; exit 1; }
info() { printf '[info] %s\n' "$1"; }
check() { command -v "$1" >/dev/null 2>&1 || fail "$1 missing"; pass "$1 present"; }

check ssh
check git
check tmux
check rg
check jq
check node
check npm
check pi
check bun
check acpx
check pi-worker-supervisor
check pi-worker-status
check pi-worker-checkpoint
check pi-worker-tail-logs
check pi-worker-verify-runtime
check pi-worker-fail-inject
check pi-worker-runtime-checklist
check pi-worker-submit-job
check pi-worker-run-job
check pi-worker-gateway
check pi-worker-telegram-bot
check pi-worker-telegram-runner
check pi-worker-acp
check pi-worker-gateway-smoke-test
check pi-worker-supervisor-smoke-test
check pi-worker-acpx-smoke-test

[[ -d "$HOME/workspaces" ]] || fail "~/workspaces missing"
pass "~/workspaces exists"

[[ -d "$HOME/.pi/agent" ]] || fail "~/.pi/agent missing"
pass "~/.pi/agent exists"

[[ -f "$HOME/.pi/agent/settings.json" ]] || fail "~/.pi/agent/settings.json missing"
pass "settings.json exists"

python3 - <<'PY'
import json
from pathlib import Path
settings = json.loads(Path.home().joinpath('.pi/agent/settings.json').read_text())
packages = settings.get('packages', [])
expected = {
    'pi-auto-skills',
    'pi-caveman',
    'pi-task-loop',
    'npm:pi-web-access',
    'npm:pi-fff',
    'npm:@tintinweb/pi-subagents',
}
configured = set()
missing_paths = []
for package in packages:
    if not isinstance(package, str):
        continue
    if package.startswith('npm:'):
        configured.add(package)
        continue
    path = Path(package)
    configured.add(path.name)
    if package.startswith('/') and not path.exists():
        missing_paths.append(package)
missing_packages = sorted(expected - configured)
if missing_packages:
    raise SystemExit('[fail] packages not configured: ' + ', '.join(missing_packages))
for package in sorted(expected):
    print(f'[pass] {package} configured')
if missing_paths:
    raise SystemExit('[fail] configured package paths missing: ' + ', '.join(missing_paths))
print('[pass] configured local package paths exist')
PY

[[ -d "$HOME/.pi-worker" ]] || fail "~/.pi-worker missing"
pass "~/.pi-worker exists"

[[ -f "$HOME/.pi-worker/bootstrap-version" ]] || fail "~/.pi-worker/bootstrap-version missing"
pass "bootstrap-version exists"

if tmux ls >/dev/null 2>&1; then
  pass "tmux reachable"
else
  printf '[info] no tmux sessions yet\n'
fi

printf '\nManual checks still needed:\n'
printf ' - SSH reconnect from remote client\n'
printf ' - Tailscale connectivity\n'
printf ' - Pi tool use inside real repo\n'
printf ' - Run pi-worker-supervisor-smoke-test or pi-worker-runtime-checklist <session>\n'
printf ' - VM snapshot after clean setup\n'
