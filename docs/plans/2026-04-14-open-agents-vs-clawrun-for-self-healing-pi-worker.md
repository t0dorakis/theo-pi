# Open Agents vs ClawRun for Self-Healing Pi Worker

## Goal

Compare `vercel-labs/open-agents` and `clawrun-sh/clawrun` as architectural references for Theo’s self-healing Pi worker, so we can deliberately choose which ideas to import now, which to delay, and which to reject.

This document builds on:

- `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`
- `docs/plans/2026-04-14-clawrun-lessons-for-self-healing-pi-worker.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`

## Executive Summary

Both repositories are useful, but they solve different parts of Theo’s problem.

### Open Agents is strongest at:

- separating control plane from execution environment
- defining sandbox operations as an interface
- treating reconnect/resume as normal runtime behavior
- keeping runtime boundaries explicit

### ClawRun is strongest at:

- supervising an agent daemon inside a sandbox
- exposing health and heartbeat state
- restarting failed runtime processes
- waking an agent from channels like Telegram
- treating channels as first-class control surfaces

### Combined lesson

Theo’s self-healing Pi worker should borrow from **both**:

- **Open Agents** for architecture boundaries
- **ClawRun** for runtime supervision and wake behavior

The result is a more complete model than either reference alone.

## The Core Difference in One Sentence

Open Agents asks:

> How should agent control and execution be separated?

ClawRun asks:

> How should a deployed agent stay alive, wake up, and recover?

Theo needs answers to both.

## Comparison by Design Concern

## 1. Control plane vs execution plane

### Open Agents

This is Open Agents’ signature strength.

It explicitly separates:

```text
Web -> Agent workflow -> Sandbox VM
```

The repo emphasizes that the agent is **not** the sandbox.

### ClawRun

ClawRun also uses sandboxes, but its strongest focus is less on “agent is not sandbox” and more on “agent inside sandbox still needs supervision.”

### Takeaway for Theo

Import Open Agents’ boundary model first:

- operator/control layer
- Pi runtime layer
- workspace execution layer

That avoids turning the worker into one big mutable box.

## 2. Runtime supervision

### Open Agents

Open Agents assumes durable workflows and reconnectable runs, but its main value is lifecycle separation rather than daemon supervision inside the sandbox.

### ClawRun

ClawRun is explicitly built around sidecar supervision:

- health server first
- daemon spawn + port readiness probe
- restart policy
- heartbeat loop
- graceful shutdown

### Takeaway for Theo

Import ClawRun’s supervision model.

Theo’s worker should not rely on Pi to be solely responsible for its own recovery. A lightweight local supervisor should own:

- restart policy
- health reporting
- liveness state
- log plumbing

## 3. Sandbox abstraction

### Open Agents

Open Agents has the cleaner, more directly reusable sandbox interface.

It defines operations like:

- read/write/stat/readdir
- exec / execDetached
- snapshot / stop / extend timeout

### ClawRun

ClawRun abstracts providers well, but at a slightly higher operational level. It is more focused on managed sandbox lifecycle than on a compact workspace-ops interface.

### Takeaway for Theo

Import Open Agents’ style of execution interface for workspace operations.

That gives Theo portability across:

- local directories now
- task containers later
- remote sandboxes later

## 4. Health and heartbeat

### Open Agents

Open Agents implies lifecycle and reconnect, but health/heartbeat is not the defining architectural center.

### ClawRun

ClawRun makes health and heartbeat explicit and machine-readable.

This is a major strength.

### Takeaway for Theo

Import ClawRun’s health/heartbeat discipline.

Even if Theo starts with SSH + `tmux`, the worker should grow:

- machine-readable health output
- heartbeat marker
- restart counters
- last-success timestamp

## 5. Telegram and other channels

### Open Agents

Open Agents is web-first. It does not center external messaging channels.

### ClawRun

ClawRun has a dedicated `channel` package and explicit wake hooks for Telegram and other platforms.

### Takeaway for Theo

Import ClawRun’s channel model if Telegram or similar external control arrives.

Do not build Telegram directly into Pi runtime. Put it in a wake/control layer.

## 6. Persistence and resume

### Open Agents

Open Agents is stronger on named persistent state objects, reconnectable runs, and explicit lifecycle state.

### ClawRun

ClawRun is stronger on sleep/wake behavior and persistent identity across sandbox sessions.

### Takeaway for Theo

Import both:

- Open Agents for explicit named runtime state
- ClawRun for sleep/wake/resume discipline

## 7. Self-healing relevance

### Open Agents

Supports self-healing **indirectly** by teaching separation and restartability.

### ClawRun

Supports self-healing **directly** by introducing a supervisor, health server, heartbeat, and restart logic.

### Takeaway for Theo

If Theo’s question is “how should the system heal when Pi crashes or hangs?”, ClawRun is the more direct reference.

If Theo’s question is “how should runtime boundaries be structured so healing is possible at all?”, Open Agents is the more direct reference.

## What to Import Now vs Later

## Import now

### From Open Agents

- explicit runtime layering
- workspace execution interface
- reconnect/resume mindset
- named state / inspectable runtime state

### From ClawRun

- lightweight supervisor concept
- machine-readable health state
- heartbeat file/endpoint
- restart counter / readiness checks

## Import later

### From Open Agents

- hosted workflow layer
- dual-sandbox hosted runtime experiments
- Vercel sandbox integration for remote work execution

### From ClawRun

- Telegram wake hooks
- general channel adapters
- sleep/wake behavior for hosted agent runtime

## Delay or reject for now

- full web UI from Open Agents
- full hosted platform assumptions from ClawRun
- Vercel-first deployment path
- replacing SSH + `tmux` as the primary operator interface too early

## Recommended Synthesis for Theo’s Worker

The best near-term architecture is not “copy one repo.” It is a synthesis.

### Near-term local VM model

```text
Theo/operator
  -> SSH / tmux / helper scripts
  -> lightweight supervisor
  -> Pi runtime
  -> workspace execution interface
  -> local bounded workspaces
```

### Later hosted/channel-aware model

```text
Telegram / web / scripts
  -> gateway / wake hooks
  -> supervisor / runtime control plane
  -> Pi runtime
  -> isolated workspace execution backend
```

## Recommended Implementation Priorities

## Priority 1 — patch the worker design docs

Add explicit runtime layers:

- operator layer
- supervisor layer
- Pi runtime layer
- workspace execution layer

## Priority 2 — add a lightweight supervisor and health model

This is the highest-value direct import from ClawRun.

## Priority 3 — add a small workspace execution interface

This is the highest-value direct import from Open Agents.

## Priority 4 — add checkpoint/heartbeat markers

This combines both projects’ lessons around restartability and continuity.

## Priority 5 — reserve a future gateway/channel slot

Do not implement Telegram immediately, but keep architecture ready for it.

## Final Recommendation

Theo should treat:

- **Open Agents** as the reference for **boundary design**
- **ClawRun** as the reference for **runtime liveness and wake behavior**

The personal autonomous Pi worker should therefore evolve as:

1. SSH-first local VM worker
2. add supervisor + health + heartbeat
3. add workspace execution abstraction
4. add optional channel/gateway layer
5. experiment with hosted sandboxes only after runtime contract is stable

## Bottom Line

If we had to reduce the comparison to one sentence:

> Open Agents tells us how to separate the system cleanly; ClawRun tells us how to keep it alive.

Theo’s self-healing Pi worker needs both.
