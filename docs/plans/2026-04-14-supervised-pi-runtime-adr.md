# ADR: Supervised Pi Runtime for Personal Autonomous Worker

## Status

Proposed

## Context

Theo’s personal autonomous Pi worker is currently designed as a local Linux VM that is accessed primarily through SSH and `tmux`. That baseline is correct because it preserves observability, keeps the worker legible during unattended runs, and matches the likely future server shape better than running Pi directly on macOS.

However, raw `tmux` alone leaves several operational concerns implicit:

- whether Pi is healthy or merely still attached to a session
- how to detect stale or failed runtime state without manual inspection
- how to restart Pi consistently after crashes or obvious wedges
- how to expose runtime state to future gateways or automation without replacing SSH-first operations

Two external references sharpen the design:

- Open Agents demonstrates the value of separating control plane, runtime, and execution environment rather than treating the system as one mutable box.
- ClawRun demonstrates the value of supervising an agent process with explicit health, heartbeat, and restart behavior instead of expecting the agent to manage its own liveness entirely.

## Decision

Theo’s self-healing Pi worker will adopt a **supervised runtime** model inside the Linux VM.

This means:

1. The local Linux VM remains the primary worker environment.
2. SSH + `tmux` remain the primary operator interface.
3. Pi runs as the worker’s agent runtime, but its liveness is managed by a lightweight supervisor layer rather than by ad hoc manual observation alone.
4. The worker will maintain explicit runtime state such as heartbeat, health, restart count, and active workspace/session metadata.
5. Future Telegram, web, or other gateway surfaces are optional control channels on top of this runtime, not replacements for the SSH-first operating model.

## Consequences

### Positive

- worker liveness becomes explicit and scriptable
- restart behavior becomes more consistent
- health can be surfaced in machine-readable form
- the architecture becomes easier to evolve toward external gateways later
- the runtime is better aligned with self-healing goals and controlled recovery

### Negative

- more moving parts than raw `tmux`
- requires agreement on runtime state files and health semantics
- introduces a small operational layer that itself must stay simple and observable

### Neutral / deliberate trade-off

- the worker remains VM-first and operator-visible rather than becoming a fully hosted agent platform immediately
- hosted channels and wake hooks remain future options, not current blockers

## Non-Goals

This decision does **not** commit Theo to:

- replacing SSH + `tmux` with a web UI
- deploying the worker on Vercel or any hosted sandbox immediately
- implementing Telegram or other wake hooks in the first milestone
- turning the worker into a hidden background service before the local supervised runtime is stable

## Follow-on Work

This ADR implies follow-on specs for:

- runtime state file layout
- supervisor behavior and restart limits
- health contract and heartbeat semantics
- workspace execution interface boundaries
- optional future gateway and wake-hook layer
