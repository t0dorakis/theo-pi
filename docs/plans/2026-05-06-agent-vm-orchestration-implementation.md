# Agent VM Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add profile-based VM orchestration with `list`, `status`, and `redeploy` for known agent VMs.

**Architecture:** Create `orchestration/` as canonical home for VM orchestration. Keep existing `scripts/vm` runtime working while `orchestration/bin/pi-orchestrator` wraps current commands and adds profile loading. Profiles are committed JSON without secrets; redeploy copies current local workspace and runtime into target VM.

**Tech Stack:** Bash, OrbStack `orbctl`, JSON profiles, `jq`, existing pi-worker scripts, Bun/npm verification.

---

### Task 1: Add profile directory and TOPI profile

**Files:**
- Create: `orchestration/profiles/topi.json`
- Create: `orchestration/profiles/mama.example.json`
- Create: `orchestration/README.md`

**Step 1: Create profiles**

`topi.json`:
```json
{
  "name": "topi",
  "vm": "theo-pi",
  "user": "minimi",
  "localWorkspace": "/Users/minimi/dev/theo-pi",
  "remoteWorkspace": "/home/minimi/workspaces/theo-pi",
  "agent": "codex",
  "sessionMode": "persistent",
  "deploymentMode": "copy",
  "services": ["gateway", "telegram", "acp", "observatory"],
  "syncCodexAuth": true
}
```

`mama.example.json`:
```json
{
  "name": "mama",
  "vm": "mama-pi",
  "user": "mama",
  "localWorkspace": "/Users/minimi/dev/multi-repo/Airbrecht",
  "remoteWorkspace": "/home/mama/workspaces/airbrecht",
  "agent": "codex",
  "sessionMode": "persistent",
  "deploymentMode": "copy",
  "services": ["gateway", "telegram", "acp", "observatory"],
  "syncCodexAuth": true
}
```

**Step 2: Document access model in README**

Explain: one profile = one VM, copy-only sandbox, secrets not committed, Telegram human surface, ACP agent surface.

**Step 3: Commit**

```bash
git add orchestration/profiles orchestration/README.md
git commit -m "docs: add agent VM orchestration profiles"
```

---

### Task 2: Add `pi-orchestrator` CLI skeleton

**Files:**
- Create: `orchestration/bin/pi-orchestrator`

**Step 1: Implement Bash CLI helpers**

Include:
- `--profile <name>` global option
- `--vm <name>` override
- `--local <path>` override
- `--remote <path>` override
- `profile_path`, `json_get`, `load_profile`
- `run_vm`
- usage text

**Step 2: Implement `list`**

Run `orbctl list`, then print committed profile names with VM status if matching VM exists.

**Step 3: Implement `status`**

Use loaded profile and delegate to existing status logic:
```bash
PI_WORKER_VM_NAME="$vm" PI_WORKER_VM_REPO_DIR="$remote" bash scripts/vm/pi-worker-instance status
```

**Step 4: Verify syntax**

```bash
bash -n orchestration/bin/pi-orchestrator
orchestration/bin/pi-orchestrator list
orchestration/bin/pi-orchestrator status --profile topi
```

**Step 5: Commit**

```bash
git add orchestration/bin/pi-orchestrator
git commit -m "feat: add pi orchestrator CLI skeleton"
```

---

### Task 3: Add profile redeploy command

**Files:**
- Modify: `orchestration/bin/pi-orchestrator`

**Step 1: Add `redeploy` command**

Behavior:
1. Resolve profile.
2. Verify local workspace exists.
3. Tar local workspace excluding `.git`, `node_modules`, `.agent`, `dist` where safe.
4. Push archive to VM with `orbctl push`.
5. Extract to `remoteWorkspace`.
6. Copy runtime scripts from orchestrator repo into `<remoteWorkspace>/scripts/vm` for current compatibility.
7. Run `npm install` if `package.json` exists.
8. Link `~/bin/pi-worker-*` to remote runtime scripts.
9. Write/update VM env: `ACPX_AGENT`, `ACPX_SESSION_MODE`, `ACPX_CWD`.
10. Optionally sync Codex auth when `syncCodexAuth=true`.
11. Restart `gateway` and `telegram`; start `observatory` when service enabled.
12. Verify health endpoints.

**Step 2: Use current working tree by default**

If no `--local`, use profile `localWorkspace`; if profile omitted and command runs inside a repo, allow `--vm ... --local "$PWD" --remote ...`.

**Step 3: Verify on TOPI**

```bash
orchestration/bin/pi-orchestrator redeploy --profile topi
orchestration/bin/pi-orchestrator status --profile topi
PI_WORKER_VM_NAME=theo-pi PI_WORKER_VM_REPO_DIR=/home/minimi/workspaces/theo-pi \
  PI_WORKER_ACP_TIMEOUT_SECONDS=180 bash scripts/vm/pi-worker-acp run 'Reply with exactly: TO_Pi ready'
```

**Step 4: Commit**

```bash
git add orchestration/bin/pi-orchestrator
git commit -m "feat: add profile redeploy command"
```

---

### Task 4: Add compatibility wrapper and docs update

**Files:**
- Modify: `scripts/vm/pi-worker-instance`
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Step 1: Add wrapper note or pass-through**

At minimum, document that new orchestration entrypoint is `orchestration/bin/pi-orchestrator`; keep old command unchanged for runtime-specific operations.

Optional: if `pi-worker-instance redeploy|list` called, forward to `orchestration/bin/pi-orchestrator`.

**Step 2: Update README commands**

Add:
```bash
orchestration/bin/pi-orchestrator list
orchestration/bin/pi-orchestrator redeploy --profile topi
orchestration/bin/pi-orchestrator status --profile topi
```

**Step 3: Verify docs and syntax**

```bash
bash -n scripts/vm/pi-worker-instance orchestration/bin/pi-orchestrator
npm run check
```

**Step 4: Commit**

```bash
git add scripts/vm/pi-worker-instance README.md docs/architecture.md
git commit -m "docs: document profile orchestration entrypoint"
```
