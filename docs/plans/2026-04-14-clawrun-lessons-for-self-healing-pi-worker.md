# ClawRun Lessons for Self-Healing Pi Worker

## Goal

Capture what `clawrun-sh/clawrun` contributes to the design of Theo’s self-healing Pi worker, especially around supervised runtime management, wake-on-message behavior, channel integration, and sandbox-resident agent operation.

This document complements:

- `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`
- `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`

## Source Material Reviewed

Primary ClawRun references used for this document:

- `README.md`
- `packages/runtime/README.md`
- `packages/agent/README.md`
- `packages/channel/README.md`
- `packages/provider-vercel/README.md`
- `packages/runtime/src/index.ts`
- `packages/runtime/src/sidecar/index.ts`
- `packages/runtime/src/sidecar/supervisor.ts`
- `packages/runtime/src/sidecar/health.ts`
- `packages/provider-vercel/src/vercel.ts`
- `packages/agent/src/index.ts`
- `packages/agent-zeroclaw/src/agent.ts`
- `packages/channel/src/telegram/wake-hook.ts`
- `packages/agent/workspace-templates/AGENTS.md`
- `packages/agent/workspace-templates/BOOTSTRAP.md`

## Executive Summary

ClawRun is more directly relevant than Open Agents to the parts of Theo’s vision that involve **persistent agent identity, wake-on-message behavior, Telegram-style channels, and keeping an agent alive inside a sandboxed environment**.

Where Open Agents is strongest on control-plane/execution-plane separation, ClawRun is strongest on **runtime supervision**. It assumes the agent process may die, may need waking, may need a heartbeat, and may need a sidecar to keep it healthy. That makes it highly relevant to the self-healing Pi worker.

The most important ClawRun lesson is this:

> A self-healing agent should not be responsible for its own liveness alone. A sidecar or supervisor should own health checks, restarts, heartbeat, and wake-up behavior.

## Important ClawRun Design Decisions

## 1. The agent runs under a sidecar supervisor

This is the single most important ClawRun design decision for Theo’s project.

Files:

- `packages/runtime/src/sidecar/index.ts`
- `packages/runtime/src/sidecar/supervisor.ts`
- `packages/runtime/src/sidecar/health.ts`

ClawRun starts a sidecar process that does four critical jobs:

1. starts a health server immediately
2. supervises the daemon process
3. runs a heartbeat loop
4. installs tools in the background

The supervisor then:

- spawns the agent daemon
- probes its readiness port
- marks it running only after a successful probe
- restarts it on exit
- limits restart attempts
- supports graceful shutdown

### Why this matters for self-healing

This directly answers one of the central problems in Theo’s vision:

- if Pi modifies itself and crashes, who notices?
- if Pi is wedged, who restarts it?
- if Pi is unhealthy, who reports that state externally?

ClawRun’s answer is: **not the agent itself**. A neighboring supervisor process owns liveness.

### What to import into the Pi worker vision

Theo’s worker should grow a small supervisor layer that sits beside Pi and manages:

- startup
- health probing
- restart policy
- structured logs
- heartbeat/last-seen markers
- graceful shutdown

For the local VM version, this supervisor could begin as a shell/Node wrapper plus health script. For a future sandboxed or hosted version, it could evolve into a true sidecar process.

## 2. Wake-on-message is first-class, not an afterthought

ClawRun explicitly supports agents that sleep when idle and wake when a message arrives.

Files and text:

- `README.md`
- `packages/channel/README.md`
- `packages/channel/src/telegram/wake-hook.ts`
- `packages/agent/workspace-templates/BOOTSTRAP.md`
- `packages/agent/workspace-templates/AGENTS.md`

The system does not assume a permanent live chat socket. Instead:

- external channels deliver a webhook or message
- the channel adapter validates and normalizes the request
- the runtime wakes or routes the agent appropriately

### Why this matters for self-healing

Theo wants optional future control channels like Telegram. ClawRun shows that messaging channels should not be treated as bespoke frontends bolted directly to the agent. They should be normalized into a generic wake/control layer.

### What to import into the Pi worker vision

If Theo adds Telegram later, the flow should look like:

```text
Telegram webhook -> validator/wake hook -> worker gateway -> Pi runtime
```

not:

```text
Telegram bot logic directly embedded in Pi process
```

This keeps channels replaceable and reduces coupling between messaging code and agent internals.

## 3. Channel adapters are separate from agent logic

ClawRun splits channels into their own package:

- `packages/channel`

with specific adapters and validators per platform:

- Telegram
- Slack
- Discord
- WhatsApp
- Lark
- others

### Why this matters for self-healing

Theo’s future control surfaces should remain optional and replaceable. The Pi worker should not be defined around Telegram any more than Open Agents should be defined around its browser UI.

### What to import into the Pi worker vision

Adopt a channel-agnostic control model:

- channels produce normalized wake/control events
- worker runtime consumes them
- Pi does not need to know which channel originated the request unless context requires it

This is useful even if Telegram is the first non-SSH control surface.

## 4. Agent implementation is pluggable behind an interface

ClawRun splits:

- `packages/agent` — abstract agent interface and registry
- `packages/agent-zeroclaw` — concrete implementation

### Why this matters for self-healing

This is a strong hint for Theo’s design: do not hard-wire every system concern directly into Pi startup scripts. Treat Pi as one possible agent runtime implementation with a clean contract.

### What to import into the Pi worker vision

Define a small internal runtime contract for the worker. A future `PiRuntime` should expose operations like:

- bootstrap
- start
- stop
- health
- send prompt
- resume state
- snapshot/checkpoint hooks

This leaves room for experimentation without making the rest of the worker architecture depend on Pi’s current invocation style.

## 5. Persistent identity lives in workspace files

ClawRun’s workspace templates are fascinating because they treat the workspace as memory-bearing identity.

Files:

- `packages/agent/workspace-templates/BOOTSTRAP.md`
- `packages/agent/workspace-templates/AGENTS.md`
- `IDENTITY.md`, `USER.md`, `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md` in templates

The agent is expected to persist key identity and continuity information in files inside the workspace.

### Why this matters for self-healing

Theo’s worker already values restartability. ClawRun suggests a practical memory discipline:

- put durable runtime knowledge into explicit files
- do not depend only on process memory or hidden internal state
- let a restarted agent recover by rereading its own workspace state

### What to import into the Pi worker vision

This aligns well with Pi. Theo’s worker should keep certain runtime continuity documents/files such as:

- worker identity/config version
- health state / last heartbeat marker
- bootstrap marker
- recovery notes
- known operator preferences / project conventions

Not all of ClawRun’s “personality file” model should be copied directly, but the principle of file-backed continuity is valuable.

## 6. Health is served over a machine-readable endpoint

ClawRun sidecar starts a health server immediately.

File:

- `packages/runtime/src/sidecar/health.ts`

Health includes:

- daemon status
- PID
- restart count
- heartbeat metadata

### Why this matters for self-healing

Theo’s current local worker design is SSH-first, which is right. But SSH-only observability is not enough for automation or future gateways.

### What to import into the Pi worker vision

Even in the VM-first phase, add machine-readable health output. It can start simple:

- local HTTP endpoint
- JSON status file
- or a CLI health command

But the status should expose at least:

- runtime healthy/unhealthy
- current Pi PID/session
- restart counter
- last successful prompt or heartbeat time
- bootstrap version

## 7. Sandbox provider is abstracted from lifecycle runtime

ClawRun separates:

- runtime/lifecycle logic
- sandbox provider implementation

Files:

- `packages/runtime`
- `packages/provider-vercel`
- `packages/provider-vercel/src/vercel.ts`

The Vercel provider wraps the sandbox backend and offers methods like:

- create
- get
- list
- snapshot
- stop
- extend timeout
- update network policy

### Why this matters for self-healing

Theo does not need Vercel first. But Theo does need portability. ClawRun reinforces the same lesson as Open Agents here: backends change; contracts should stay stable.

### What to import into the Pi worker vision

For Theo’s worker, define a provider boundary early enough that the runtime could later run on:

- local Linux VM only
- local VM + per-task containers
- Vercel sandbox for work execution
- future hosted runtime

This boundary does not need to be large. It only needs to prevent total entanglement.

## 8. Heartbeat is normal runtime behavior

ClawRun sidecar maintains heartbeat behavior as part of the runtime itself.

Files:

- `packages/runtime/src/sidecar/index.ts`
- references throughout runtime and provider code

### Why this matters for self-healing

Heartbeats are useful even before hosted deployment. Theo’s worker can benefit from a much lighter version of the same idea:

- when was the worker last known alive?
- when did Pi last successfully complete a turn?
- is the process stale or merely idle?

### What to import into the Pi worker vision

A heartbeat file or endpoint updated by supervisor/runtime would make unattended recovery easier and would support future message-driven wake behavior.

## What ClawRun does **not** give us directly

## 1. It does not remove need for SSH-first operations today

Theo’s current worker plan is still right to begin with SSH + `tmux`. ClawRun’s model is more platform-like and more hosted. The local worker should not be over-abstracted too early.

## 2. It does not define safe self-modification policy for Pi

ClawRun is strong on supervision, but it does not answer the exact Theo-specific questions about when Pi should be allowed to patch itself, update packages, or roll back.

## 3. It is more focused on hosted channel delivery than personal operator control

That makes it highly useful for future Telegram-style interaction, but less useful as a direct replacement for the operator-driven Linux VM workflow in the near term.

## Concrete Recommendations for Theo’s Worker Documents

## A. Add a supervisor layer to the architecture

In the worker design, explicitly add a small runtime supervisor concept between `tmux`/operator control and Pi itself.

That supervisor should own:

- launch
- restart
- health
- heartbeat
- log location

## B. Add a future channel/wake abstraction

Do not implement Telegram immediately, but reserve an architecture slot for:

- validators
- wake hooks
- normalized external control signals

## C. Add file-backed continuity markers

Adopt a small set of explicit state files for worker continuity and crash recovery.

## D. Add machine-readable health early

Even before hosted deployment, expose worker health in a way a script or future gateway can consume.

## E. Keep sandbox provider boundary optional but real

Even if the local VM is the only backend initially, keep enough separation that a Vercel sandbox experiment can be added later.

## Proposed Runtime Model After Importing ClawRun Lessons

The revised target operating model becomes:

```text
Theo/operator or future channel
  -> gateway / wake hook layer
  -> supervisor / sidecar layer
  -> Pi runtime
  -> bounded workspace execution
```

For the earliest local VM phase, that can collapse practically into:

```text
SSH / tmux / helper scripts
  -> lightweight supervisor
  -> Pi
  -> workspaces
```

For a future hosted phase, it evolves toward:

```text
Telegram / web / scripts
  -> wake + control layer
  -> sandbox supervisor
  -> Pi daemon/runtime
  -> isolated work execution backend
```

## Bottom Line

The most important ClawRun lesson for Theo’s self-healing Pi worker is this:

> A durable agent should be supervised, health-checked, restartable, and wakeable from outside itself.

ClawRun should therefore be treated as the main reference for:

- sidecar/supervisor design
- health endpoints
- restart policy
- heartbeat behavior
- wake-on-message channels like Telegram
- persistent agent identity inside sandboxed runtimes

It should **not** be treated as proof that Theo must adopt its full hosted platform model immediately.
