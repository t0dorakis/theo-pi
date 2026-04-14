# Pi Worker Progress — 2026-04-14

## Goal

Set up a personal remote-capable Pi worker on Theo's MacBook Air using a terminal-first workflow, with future portability to a server or remote container/VM.

## Decisions made

- Dropped **UTM** for this use case because it was too manual and not terminal-first enough.
- Chose **OrbStack** instead because it supports CLI-driven Linux machines and is a better fit for local-now / cloud-later workflows.
- Confirmed Pi supports **subscription auth** via OAuth, including **OpenAI ChatGPT Plus/Pro (Codex)**.
- Confirmed the current local Pi session appears to be using subscription auth, based on footer `(sub)` and Pi docs/code.
- Chose to reuse that subscription auth in the OrbStack guest by copying Pi auth state instead of forcing API-key setup.

## Research findings

### Pi auth

Pi docs explicitly say built-in subscription providers include:
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

OAuth tokens are stored in:
- `~/.pi/agent/auth.json`

Pi footer code marks cost with `(sub)` when OAuth-backed subscription auth is active.

### OpenAI / Codex remote auth

OpenAI docs support remote/headless Codex subscription use via:
- `codex login --device-auth`
- copying `~/.codex/auth.json`
- SSH port forwarding for browser callback

This strongly suggests remote subscription-backed coding-agent flows are normal in 2026.

## Local machine work completed

### OrbStack

Installed:

```bash
brew install --cask orbstack
open -a OrbStack
```

Created Linux machine:
- name: `pi-worker`
- distro: `ubuntu:noble`
- arch: `arm64`

Final working machine info at time of writing:
- machine: `pi-worker`
- distro: Ubuntu Noble / 24.04 LTS
- IP seen during setup: `192.168.139.68`

### Cloud-init and bootstrap

Created OrbStack cloud-init template in repo:
- `templates/pi-worker/orbstack-cloud-init.yaml`

This cloud-init:
- creates `piagent`
- adds Theo SSH key
- installs base packages
- creates Pi worker directories

### Guest setup completed

Inside OrbStack machine, installed/configured:
- `git`
- `tmux`
- `curl`
- `jq`
- `ripgrep`
- `fd-find`
- Node 22
- `@mariozechner/pi-coding-agent`
- `pi-web-access`

Copied local repo state into guest:
- host repo copied into `/home/piagent/workspaces/theo-pi`
- used tar streaming instead of git clone, because local repo had uncommitted changes that needed to exist in guest too
- cleaned macOS `._*` metadata files afterward

Wrote Pi guest config:
- `/home/piagent/.pi/agent/settings.json`
- `/home/piagent/.pi/agent/APPEND_SYSTEM.md`
- `/home/piagent/.env.pi`

### Verification completed

Guest verification script passed:
- `~/workspaces/theo-pi/scripts/vm/pi-worker-verify.sh`

Verified inside guest:
- `node -v`
- `npm -v`
- `pi --version`
- Pi package config exists
- caveman package configured
- auto-skills package configured

## Subscription auth transfer completed

Read local Pi auth file:
- `/Users/theo/.pi/agent/auth.json`

It contained OAuth entries for:
- `anthropic`
- `openai-codex`

Copied it into guest:
- `/home/piagent/.pi/agent/auth.json`

Permissions set to `0600`.

### Verified Codex subscription works in guest

Listed models in guest:

```bash
pi --list-models codex
```

This showed `openai-codex` models including:
- `gpt-5.4`
- `gpt-5.3-codex`
- others

Then verified actual subscription-backed request in guest:

```bash
pi --no-session --provider openai-codex --model gpt-5.4 --tools read -p "Say hi in two words"
```

Output:

```text
Hi there
```

Meaning:
- remote/local OrbStack Pi worker can use Theo's **ChatGPT subscription-backed Codex auth**
- API key is not required for this path

## Files created or updated during this session

### Repo files
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-bootstrap-checklist.md`
- `docs/plans/2026-04-14-pi-worker-progress.md`
- `scripts/vm/bootstrap-ubuntu-pi-worker.sh`
- `scripts/vm/install-theo-pi-worker.sh`
- `scripts/vm/pi-worker-start`
- `scripts/vm/pi-worker-verify.sh`
- `templates/pi-worker/settings.json`
- `templates/pi-worker/env.pi.example`
- `templates/pi-worker/sshd_config.append.example`
- `templates/pi-worker/orbstack-cloud-init.yaml`
- `README.md`

### Local/host state
- OrbStack app installed and running
- OrbStack machine `pi-worker` created
- SSH key created for VM work:
  - `/Users/theo/.ssh/pi-worker`
  - `/Users/theo/.ssh/pi-worker.pub`

### Guest state
- `/home/piagent/workspaces/theo-pi`
- `/home/piagent/.pi/agent/settings.json`
- `/home/piagent/.pi/agent/APPEND_SYSTEM.md`
- `/home/piagent/.pi/agent/auth.json`
- `/home/piagent/.env.pi`

## Known caveats

- OrbStack `docker` path is not yet preferred on host; `orbctl doctor` warned that Homebrew Docker still shadows OrbStack Docker.
- Tailscale is **not installed yet** in guest.
- No remote gateway/UI exists yet.
- Persistent tmux/session setup was started conceptually, but next session should make it first-class and test reconnect flow.
- UTM path was abandoned; current working path is OrbStack only.

## Auto skill saved/patched

Auto skill created and later patched:
- `~/.agents/skills/auto/orbstack-cli-pi-worker-bootstrap/SKILL.md`

It now includes:
- OrbStack CLI workflow
- cloud-init user creation
- host repo copy into guest
- npm `sudo` pitfalls
- Pi OAuth auth copy via `~/.pi/agent/auth.json`
- Codex subscription verification steps

## Recommended next session

Build remote connectivity layer:

1. install **Tailscale** inside `pi-worker`
2. verify remote SSH or tailnet access
3. design and implement **gateway** for remote connection/control
4. decide whether gateway should:
   - proxy Pi TUI-like control
   - expose a simple web relay
   - or mirror Anthropic-style outbound relay behavior
5. add persistent tmux or managed launcher for `pi`
6. test reconnect flow from another device/network

## Quick commands for next session

### Host

```bash
orbctl list
orbctl info pi-worker
ssh -p 32222 -i ~/.orbstack/ssh/id_ed25519 piagent@localhost
```

### Guest

```bash
cd ~/workspaces/theo-pi
pi --list-models codex
pi --provider openai-codex --model gpt-5.4
```

### Verified test command

```bash
pi --no-session --provider openai-codex --model gpt-5.4 --tools read -p "Say hi in two words"
```
