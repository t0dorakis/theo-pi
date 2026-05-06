# Agent VM Orchestration Design

## Goal

Build a small orchestration layer in this repo that can redeploy and operate known agent VMs, where each profile maps to one VM and one allowed workspace repo/folder.

## Requirements

- One profile equals one VM by default.
- Profiles are committed JSON files and contain no secrets.
- Secrets live in ignored per-profile env files or existing host auth stores.
- Redeploy copies current local working tree for a target workspace into VM; no clean git state required.
- Orchestrator repo owns runtime scripts, templates, docs, and profile configs.
- Target VMs receive only minimal runtime plus their configured workspace.
- Telegram is primary human interface.
- ACP is primary agent-to-agent interface.
- Observatory can watch profile job events.

## Proposed layout

```text
orchestration/
  bin/pi-orchestrator
  profiles/
    topi.json
    mama.json
  runtime/
    bin/
    src/
    tests/
  templates/
    env.example
    cloud-init.yaml
  docs/
    architecture.md
    glossary.md
```

Legacy files under `scripts/vm/` remain as wrappers during migration.

## Profile model

Example profile:

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
  "services": ["gateway", "telegram", "acp", "observatory"]
}
```

## CLI shape

```bash
orchestration/bin/pi-orchestrator list
orchestration/bin/pi-orchestrator status --profile topi
orchestration/bin/pi-orchestrator redeploy --profile topi
orchestration/bin/pi-orchestrator acp --profile mama "review this"
orchestration/bin/pi-orchestrator logs --profile mama --service telegram
```

## Access model

Copy-only sandbox first: VM sees only its Linux filesystem, copied runtime, copied target workspace, configured auth, and network. It does not see the host Mac filesystem unless future `deploymentMode: "mount"` is added.

## Migration plan

1. Add orchestration folder and profile schema.
2. Add `topi.json` profile for existing `theo-pi` VM.
3. Add `pi-orchestrator list/status/redeploy` using existing `orbctl` and runtime scripts.
4. Add compatibility wrapper from `scripts/vm/pi-worker-instance` to new CLI.
5. Move runtime scripts gradually or keep thin wrappers until stable.
6. Add `mama.example.json` or `mama.json` once exact Airbrecht path and VM name are known.

## Open details

- Exact local path spelling for Airbrecht workspace.
- Whether profile env files should live at `orchestration/profiles/<name>.env.local` or `~/.pi-orchestrator/<name>.env`.
- Whether Codex auth sync should be automatic opt-in per profile.
