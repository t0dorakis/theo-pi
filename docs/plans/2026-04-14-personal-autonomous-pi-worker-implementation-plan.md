# Personal Autonomous Pi Worker on Local Linux VM — Implementation Plan

## Objective

Build a personal Pi worker that runs inside a local Linux VM on Theo’s MacBook Air, stays alive while Theo is away, and is reachable remotely over SSH. The worker must support normal `pi-coding-agent` workflows: file creation/editing, bash/CLI usage, git/GitHub workflows, web search, and installed Pi packages.

---

## Chosen Stack

### Host
- macOS on MacBook Air

### Virtualization
- **Preferred:** UTM
- **Fallback:** VMware Fusion / Parallels / OrbStack VM mode

Why UTM:
- simple local VM workflow on Apple Silicon
- good enough for one personal always-on worker
- snapshot support
- easy Linux guest setup

### Guest OS
- **Ubuntu Server 24.04 LTS**

Why:
- best balance of documentation, package availability, and long-term support
- easy Node, Tailscale, tmux, git, browser/tooling setup

---

## Phase 1 — Create VM and Base System

### VM sizing
Initial target:
- 4 CPU cores
- 8 GB RAM if available, otherwise 6 GB minimum
- 40–80 GB disk

If MacBook Air resources are tight:
- start with 4 GB RAM
- but expect lower parallelism and slower large tasks

### Guest install checklist
1. Create Ubuntu Server VM in UTM
2. Enable SSH during install if possible
3. Create dedicated user:
   - `piagent`
4. Apply system updates:

```bash
sudo apt update && sudo apt upgrade -y
```

5. Install base packages:

```bash
sudo apt install -y git curl tmux build-essential ripgrep fd-find jq gh unzip zip
```

6. Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

7. Install Pi:

```bash
npm install -g @mariozechner/pi-coding-agent
pi --version
```

Success criteria:
- VM boots cleanly
- `ssh piagent@<vm-ip>` works on local network
- `pi --version` works inside guest

---

## Phase 2 — Workspace and Pi Layout

### Directory layout
Create bounded worker structure:

```bash
mkdir -p ~/workspaces
mkdir -p ~/.pi/agent
mkdir -p ~/.agents/skills
mkdir -p ~/logs
```

Recommended project layout:

```text
/home/piagent/
  workspaces/
    theo-pi/
    project-x/
  logs/
  .pi/
  .agents/
```

### Install Theo Pi packages
Option A: clone repo inside VM

```bash
cd ~/workspaces
git clone git@github.com:t0dorakis/theo-pi.git
cd ~/workspaces/theo-pi
npm install
```

Add local packages to Pi settings:

```json
{
  "packages": [
    "../../workspaces/theo-pi/packages/pi-auto-skills",
    "../../workspaces/theo-pi/packages/pi-caveman",
    "npm:pi-web-access"
  ]
}
```

### Copy packaged prompt starter if needed

```bash
mkdir -p ~/.pi/agent
cp ~/workspaces/theo-pi/packages/pi-caveman/APPEND_SYSTEM.md ~/.pi/agent/APPEND_SYSTEM.md
```

Success criteria:
- Pi starts inside guest
- installed extensions load cleanly
- caveman mode and web access available

---

## Phase 3 — SSH and Remote Access

### Initial local SSH
Use normal SSH first.

1. Generate or reuse key on Theo’s laptop
2. Add public key to VM:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

3. Verify SSH login from macOS host

### Preferred remote access: Tailscale
Install Tailscale in guest:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then verify:
- VM appears on tailnet
- Theo can SSH using tailnet hostname/IP

### SSH hardening
Edit `/etc/ssh/sshd_config`:
- disable password auth if possible
- disable root login
- keep key auth only

Then:

```bash
sudo systemctl restart ssh
```

Success criteria:
- Theo can SSH into VM locally
- Theo can SSH into VM remotely via Tailscale
- no public Pi endpoint exposed

---

## Phase 4 — Running Pi Reliably with tmux

### tmux convention
One tmux session per project:

```bash
tmux new -s theo-pi
cd ~/workspaces/theo-pi
pi
```

Reattach:

```bash
tmux attach -t theo-pi
```

List sessions:

```bash
tmux ls
```

### Naming convention
Use stable names:
- `theo-pi`
- `client-a`
- `sandbox-test`

### Optional helper script
Create `~/bin/pi-worker-start`:

```bash
#!/usr/bin/env bash
set -e
SESSION_NAME="$1"
WORKDIR="$2"
if [ -z "$SESSION_NAME" ] || [ -z "$WORKDIR" ]; then
  echo "usage: pi-worker-start <session> <workdir>"
  exit 1
fi
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "session exists: $SESSION_NAME"
  exit 0
fi
tmux new-session -d -s "$SESSION_NAME" "cd '$WORKDIR' && pi"
echo "started $SESSION_NAME"
```

Make executable:

```bash
chmod +x ~/bin/pi-worker-start
```

Success criteria:
- Pi keeps running after SSH disconnect
- Theo can reconnect and inspect state
- multiple project sessions possible

---

## Phase 5 — Runtime Supervision and Observability

### Goal
Add a lightweight supervisor layer on top of the SSH + `tmux` workflow so the worker has explicit liveness, restart, heartbeat, and health state instead of relying on manual observation alone.

### Minimum responsibilities
The first supervisor version should:
- start Pi in a named session/workspace
- detect obvious process failure
- record restart count and last-known-good state
- write a heartbeat marker
- expose a simple status command or JSON health output
- write logs to a known location

### Initial runtime state layout
Reserve a worker state directory such as:

```text
~/.pi-worker/
  state.json
  heartbeat.json
  health.json
  supervisor.log
  checkpoints/
```

The exact implementation can be shell-first initially, but the files and meanings should be explicit.

### Suggested commands
First version should center on supervisor-oriented helper commands such as:

```bash
pi-worker-supervisor start <session> <workdir>
pi-worker-supervisor status
pi-worker-supervisor restart <session>
pi-worker-supervisor stop <session>
```

If a shorter `pi-worker-status` alias exists later, it should map cleanly onto `pi-worker-supervisor status` rather than creating a second status contract.

### Verification goals
- health command returns current session/workspace status
- heartbeat timestamp updates while Pi is healthy
- supervisor log path is documented and populated
- killing Pi process leads to detectable failure and documented restart flow

Success criteria:
- worker health is machine-readable, not only visible in `tmux`
- restart path after Pi failure is documented and testable
- runtime state files exist in known locations
- Theo can distinguish idle, healthy, stale, and failed states quickly

---

## Phase 6 — Credentials and Secrets

### Principle
Only give the VM the secrets it truly needs.

### Required likely secrets
- model provider API keys
- GitHub deploy key or limited token
- web-search config if needed

### Storage options
Preferred simple approach:
- env file readable only by `piagent`

Example:

```bash
chmod 600 ~/.env.pi
```

Contents:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
```

Load in shell profile or launch script.

### GitHub access
Preferred:
- repo-specific deploy keys where practical

Fallback:
- `gh auth login` with limited-scope token

### Web search config
If needed:

`~/.pi/web-search.json`

Success criteria:
- Pi can access required providers/tools
- no unrelated host secrets copied into VM
- GitHub access works for intended repos only

---

## Phase 7 — Hardening

### Minimum hardening checklist
- dedicated Linux user: `piagent`
- no root runtime
- SSH keys only
- Tailscale/private access only
- no public Pi/web endpoint
- bounded workspace under `~/workspaces`
- only required credentials present
- VM snapshot after clean baseline

### Recommended extras
Install firewall:

```bash
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw enable
```

If using only Tailscale SSH, tune rules accordingly.

### Recovery posture
- prefer restartability over debugging forever
- keep clean VM snapshot after base setup
- use git remotes as source of truth for code state
- Pi sessions are helpful, not sole recovery mechanism

---

## Phase 8 — Verification Checklist

### Base environment
- [ ] VM boots and resumes cleanly
- [ ] `pi --version` works
- [ ] Node/npm installed
- [ ] `tmux`, `git`, `gh`, `rg` available

### Pi behavior
- [ ] `pi` launches in guest
- [ ] `pi-caveman` loads
- [ ] `pi-auto-skills` loads
- [ ] `pi-web-access` loads
- [ ] `/reload` works cleanly

### Runtime supervision
- [ ] supervisor can start Pi in target session/workspace
- [ ] `pi-worker-status` or equivalent health command works
- [ ] heartbeat timestamp updates while worker is healthy
- [ ] supervisor log location is known and populated
- [ ] killing Pi triggers a detectable failure and documented restart path

### Remote access
- [ ] local SSH works
- [ ] remote Tailscale SSH works
- [ ] tmux session survives disconnect
- [ ] Pi survives SSH disconnect

### Tooling
- [ ] Pi can read/write files in workspace
- [ ] Pi can run bash commands
- [ ] Pi can use git in repo
- [ ] Pi can do web search

### Safety
- [ ] Pi cannot access unrelated host files
- [ ] secrets are stored only in guest
- [ ] VM snapshot created after clean setup

---

## Phase 9 — Next Upgrade Path

Once local VM worker is stable, next upgrade options are:

1. move same Ubuntu worker to VPS/bare server
2. add startup automation for tmux sessions
3. add lightweight health-check script
4. add per-task sandboxing inside VM with Docker/Incus
5. add RPC/SDK wrapper or wake-hook gateway only if an external control plane becomes necessary

---

## Immediate Action Order

1. Create Ubuntu Server VM in UTM
2. Install SSH, Node 22, tmux, git, Pi
3. Verify local SSH into guest
4. Clone `theo-pi` into `~/workspaces`
5. Install Pi packages/config inside guest
6. Start Pi in tmux for one repo
7. Add lightweight supervisor, health, and heartbeat state
8. Install Tailscale and verify remote SSH
9. Create clean snapshot
10. Run unattended test: disconnect, leave Pi running, reconnect later
