# Pi Worker Architecture: Supervised Runtime on OrbStack VM

```
╔══════════════════════════════════════════════════════════════════════════╗
║  macOS Host  (MacBook Air)                                               ║
║                                                                          ║
║  ┌─────────────────────────────────────────────────────────────────┐    ║
║  │  OrbStack                                                        │    ║
║  │                                                                  │    ║
║  │  ┌───────────────────────────────────────────────────────────┐  │    ║
║  │  │  Ubuntu Linux VM  (piagent user)                          │  │    ║
║  │  │                                                           │  │    ║
║  │  │  ┌─────────────────────────────────────────────────────┐ │  │    ║
║  │  │  │  Operator Layer                                      │ │  │    ║
║  │  │  │  ssh piagent@vm  ──►  tmux attach -t <session>      │ │  │    ║
║  │  │  │  ~/bin/pi-worker-{start,status,restart,stop,...}     │ │  │    ║
║  │  │  └────────────────────────┬────────────────────────────┘ │  │    ║
║  │  │                           │ starts / manages             │  │    ║
║  │  │  ┌────────────────────────▼────────────────────────────┐ │  │    ║
║  │  │  │  Supervisor Layer  (pi-worker-supervisor)            │ │  │    ║
║  │  │  │                                                      │ │  │    ║
║  │  │  │  • starts Pi in named tmux session + workspace       │ │  │    ║
║  │  │  │  • heartbeat every 30 s  →  ~/.pi-worker/heartbeat   │ │  │    ║
║  │  │  │  • health check every 2 s  →  ~/.pi-worker/health    │ │  │    ║
║  │  │  │  • auto-restart on crash (max 5, 2 s backoff)        │ │  │    ║
║  │  │  │  • supervisor.log  /  sessions/<name>.json           │ │  │    ║
║  │  │  │  • checkpoint / verify / tail-logs commands          │ │  │    ║
║  │  │  └────────────────────────┬────────────────────────────┘ │  │    ║
║  │  │                           │ spawns                        │  │    ║
║  │  │  ┌────────────────────────▼────────────────────────────┐ │  │    ║
║  │  │  │  Pi Runtime Layer  (pi-coding-agent)                 │ │  │    ║
║  │  │  │                                                      │ │  │    ║
║  │  │  │  • tmux session  (1 session per project)             │ │  │    ║
║  │  │  │  • ~/.pi/agent/  — prompts, system config            │ │  │    ║
║  │  │  │  • ~/.agents/skills/  — auto-skills store            │ │  │    ║
║  │  │  │  • ~/.env.pi  — API keys (chmod 600)                 │ │  │    ║
║  │  │  │  • packages: pi-auto-skills, pi-caveman, pi-web-access│ │  │    ║
║  │  │  └────────────────────────┬────────────────────────────┘ │  │    ║
║  │  │                           │ reads/writes                  │  │    ║
║  │  │  ┌────────────────────────▼────────────────────────────┐ │  │    ║
║  │  │  │  Workspace Execution Layer                           │ │  │    ║
║  │  │  │                                                      │ │  │    ║
║  │  │  │  ~/workspaces/<project>/  — git repos, task files   │ │  │    ║
║  │  │  │  bash · git · node · ripgrep · jq · gh              │ │  │    ║
║  │  │  └─────────────────────────────────────────────────────┘ │  │    ║
║  │  │                                                           │  │    ║
║  │  └───────────────────────────────────────────────────────────┘  │    ║
║  └─────────────────────────────────────────────────────────────────┘    ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

Remote operator path (Tailscale or LAN SSH):
  Operator  ──SSH──►  VM :22  ──►  tmux attach
```

## State files

```
~/.pi-worker/
├── state.json          active session snapshot (runtimeVersion, pid, status)
├── health.json         ok/unhealthy, daemonStatus, restartCount, heartbeat ts
├── heartbeat.json      lastHeartbeatAt, lastSuccessAt
├── supervisor.log      timestamped supervisor events
├── sessions/
│   ├── <name>.json     per-session state
│   ├── <name>.stop     sentinel: graceful stop requested
│   └── <name>.supervisor.pid
└── checkpoints/
    ├── latest.json
    └── <label>-<ts>.json
```

## Key scripts

| Script | Purpose |
|---|---|
| `bootstrap-ubuntu-pi-worker.sh` | One-shot VM provisioning (apt, Node, Pi, dirs) |
| `install-theo-pi-worker.sh` | Clone/update repo + configure Pi packages in guest |
| `pi-worker-supervisor` | Core supervisor (`start/status/restart/stop/checkpoint/verify/tail-logs`) |
| `pi-worker-{start,stop,...}` | Thin wrappers forwarding to supervisor |
| `pi-worker-fail-inject` | Testing: inject crash/stale/break-workspace faults |
| `pi-worker-runtime-checklist` | Verify supervised-runtime invariants against live session |
| `templates/pi-worker/orbstack-cloud-init.yaml` | Cloud-init for OrbStack VM first boot |

## Supervisor lifecycle

```
  start ──► [starting]
              │
              ▼  tmux session created, Pi launched
           [running] ◄──── heartbeat loop (30 s)
              │    │
       crash  │    └── stop sentinel ──► [stopped]
              ▼
          [failed / stale]
              │
    restart count < 5 ──► re-launch ──► [running]
    restart count ≥ 5 ──► [failed]  (manual recovery)
```
