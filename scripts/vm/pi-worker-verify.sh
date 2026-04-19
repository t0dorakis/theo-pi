#!/usr/bin/env bash
set -euo pipefail

pass() { printf '[pass] %s\n' "$1"; }
fail() { printf '[fail] %s\n' "$1"; exit 1; }
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
check pi-worker-supervisor
check pi-worker-status
check pi-worker-checkpoint
check pi-worker-tail-logs
check pi-worker-verify-runtime
check pi-worker-fail-inject
check pi-worker-runtime-checklist
check pi-worker-delegate
check pi-worker-submit-job
check pi-worker-run-job
check pi-worker-gateway
check pi-worker-telegram-bot
check pi-worker-gateway-smoke-test
check pi-worker-supervisor-smoke-test

[[ -d "$HOME/workspaces" ]] || fail "~/workspaces missing"
pass "~/workspaces exists"

[[ -d "$HOME/.pi/agent" ]] || fail "~/.pi/agent missing"
pass "~/.pi/agent exists"

[[ -f "$HOME/.pi/agent/settings.json" ]] || fail "~/.pi/agent/settings.json missing"
pass "settings.json exists"

if grep -q 'pi-caveman' "$HOME/.pi/agent/settings.json"; then
  pass "pi-caveman configured"
else
  fail "pi-caveman not configured"
fi

if grep -q 'pi-auto-skills' "$HOME/.pi/agent/settings.json"; then
  pass "pi-auto-skills configured"
else
  fail "pi-auto-skills not configured"
fi

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
