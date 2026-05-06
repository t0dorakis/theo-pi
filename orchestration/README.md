# Agent VM Orchestration

This folder owns profile-based orchestration for agent VMs.

## Model

- One profile maps to one VM.
- One VM gets one copied workspace folder by default.
- Profiles are committed JSON and must not contain secrets.
- Secrets stay in ignored env files or host auth stores such as `~/.codex`.
- Telegram is the primary human interface.
- ACP is the primary agent-to-agent interface.

## Commands

```bash
orchestration/bin/pi-orchestrator list
orchestration/bin/pi-orchestrator status --profile topi
orchestration/bin/pi-orchestrator redeploy --profile topi
orchestration/bin/pi-orchestrator acp --profile mama "review this"
```

## Profiles

Profiles live in `orchestration/profiles/*.json`.

Current profiles:

- `topi` -> existing `theo-pi` VM, workspace `/Users/minimi/dev/theo-pi`.
- `mama` -> future `mama-pi` VM, workspace `/Users/minimi/dev/multi/projects/mutter-erbe`.

## Sandbox

`deploymentMode: "copy"` means redeploy tars the local workspace into the VM. The VM does not get live access to the whole Mac filesystem by project convention.

Profiles may opt into broader trusted behavior with `trustLevel: "orchestrator"`. `topi` is such a profile: it can use host-backed developer CLIs such as Graphite via `hostCliMounts`, plus GitHub CLI auth inside the VM. Worker profiles should avoid host CLI/auth mounts and use dedicated repo-scoped credentials instead.
