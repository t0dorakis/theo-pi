# Open Agents Lessons for Self-Healing Pi Worker

## Goal

Capture what `vercel-labs/open-agents` contributes to the design of Theo’s self-healing Pi worker, without assuming we should copy the whole product or adopt its web-first surface area. This document is a design reference for the worker vision in:

- `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`

## Source Material Reviewed

Primary Open Agents references used for this document:

- `README.md` in `vercel-labs/open-agents`
- `docs/agents/architecture.md`
- `packages/sandbox/interface.ts`
- `packages/sandbox/factory.ts`
- `packages/sandbox/vercel/connect.ts`
- `packages/agent/open-harness-agent.ts`
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/chat/_lib/runtime.ts`
- `apps/web/app/workflows/chat.ts`

## Executive Summary

Open Agents is most useful to the self-healing Pi worker vision as a **runtime architecture reference**, not as a product to clone whole. The most important idea is not its web UI or Vercel deployment target. The most important idea is that it draws a hard boundary between **control plane**, **agent runtime**, and **execution environment**.

That maps cleanly onto Theo’s worker design:

```text
Theo/operator access -> Pi runtime machine -> bounded workspace execution
```

Open Agents repeatedly chooses separation over convenience. That is exactly what a self-healing Pi worker needs. The worker should not be designed as “one immortal process in one big mutable machine.” It should be designed as layered runtime parts that can be observed, restarted, reconnected, snapshotted, and eventually moved to other infrastructure.

## Important Open Agents Design Decisions

### 1. Agent is not sandbox

This is the single most important Open Agents design decision.

In the Open Agents README, the project states that the architecture is:

```text
Web -> Agent workflow -> Sandbox VM
```

It also explicitly says:

- the agent does **not** run inside the VM
- the VM is the execution environment
- separating the two allows each lifecycle to evolve independently

This matters for the Pi worker because the personal worker design already treats the Linux VM as an agent machine, not just a terminal session. Open Agents sharpens that further: even *inside* the worker machine, we should avoid collapsing the runtime into one undifferentiated environment.

### What to import into the Pi worker vision

For Theo’s worker, this suggests three layers:

1. **Operator layer**
   - SSH
   - `tmux`
   - health scripts
   - restart commands

2. **Pi runtime layer**
   - Pi installation
   - Pi config
   - Pi sessions
   - Pi skills/extensions
   - self-healing logic

3. **Workspace execution layer**
   - project repos
   - destructive task execution
   - optional future task sandboxes/containers

The worker should not assume the Pi runtime and the work target are always the same thing.

## 2. Lifecycle separation is a first-class design choice

Open Agents does not merely separate files or packages. It separates **lifecycles**.

The README and workflow code together show this pattern:

- a chat request starts a workflow run
- the workflow executes the agent
- the agent interacts with a sandbox
- the sandbox can hibernate/resume independently
- runs can reconnect to active state

This is reinforced by:

- `apps/web/app/api/chat/route.ts`
- `apps/web/app/workflows/chat.ts`
- `packages/sandbox/factory.ts`
- `packages/sandbox/vercel/connect.ts`

### Why this matters for self-healing

Theo’s worker design already says “restartability over immortality.” Open Agents provides a stronger runtime interpretation of that principle:

- a healthy system does not depend on one fragile long-lived process
- reconnect should be normal, not emergency behavior
- restart and resume should be designed in from the beginning
- state should be explicit enough to rebuild runtime from checkpoints

### What to import into the Pi worker vision

The self-healing worker should maintain explicit runtime state such as:

- which workspace is active
- which `tmux` session owns the active Pi process
- whether Pi is healthy or degraded
- when the last successful checkpoint happened
- whether a risky self-modification is in progress

This does **not** require copying Vercel Workflow. It requires copying the discipline of explicit runtime state and reconnection.

## 3. Sandbox is an interface, not an implementation

One of the strongest reusable ideas in Open Agents is the sandbox interface in:

- `packages/sandbox/interface.ts`

The interface defines operations like:

- `readFile`
- `writeFile`
- `stat`
- `readdir`
- `exec`
- `execDetached`
- `snapshot`
- `stop`
- `extendTimeout`
- `getState`

Then `packages/sandbox/factory.ts` and `packages/sandbox/vercel/connect.ts` bind those operations to the current implementation.

### Why this matters for self-healing

Theo’s worker design currently chooses a Linux VM because it matches the likely future server shape better than a local macOS process. Open Agents strengthens that position by showing a path to **portable execution control**.

If the Pi worker builds around a workspace execution interface early, then these can change later without redesigning the whole worker:

- local directory execution
- per-project shell execution
- Docker/Incus task sandboxing inside the VM
- remote VM execution
- Vercel-like sandbox execution in a future hosted version

### What to import into the Pi worker vision

Even for the local Linux VM design, define a small internal execution interface for workspaces. Something like:

- read
- write
- edit
- bash/exec
- list/search
- checkpoint/snapshot

At first, it can point at ordinary directories inside `/home/piagent/workspaces`. Later, it can point at stronger per-task isolation without changing the rest of the worker runtime.

## 4. Persistence should have names, not vibes

Open Agents uses explicit sandbox state objects. In particular:

- `packages/sandbox/factory.ts`
- `packages/sandbox/vercel/state.ts`
- `packages/sandbox/vercel/connect.ts`

show persistent concepts like:

- named sandboxes
- reconnect/resume
- create-if-missing
- snapshot restore
- expiration state

### Why this matters for self-healing

The personal Pi worker should avoid fuzzy persistence like “it’s still running in some shell somewhere.” Instead, persistence should be tracked with named, inspectable artifacts.

### What to import into the Pi worker vision

Examples of explicit state Theo’s worker should maintain:

- stable `tmux` session names per project
- stable workspace IDs/paths
- explicit marker files for runtime health
- known checkpoint locations
- known bootstrap version / worker version

This makes recovery procedural instead of improvisational.

## 5. Snapshotting is not optional polish

Open Agents treats snapshots and resume behavior as operational primitives, not as backup garnish. This shows up in the sandbox interface and connection logic, and also in the broader sandbox lifecycle documentation in the repo.

### Why this matters for self-healing

Theo’s worker design already recommends creating a clean VM snapshot after setup. Open Agents suggests going further: use checkpointing and snapshots as part of normal runtime behavior.

### What to import into the Pi worker vision

Use at least three checkpoint levels:

1. **Machine baseline**
   - clean VM snapshot after worker bootstrap

2. **Worker runtime checkpoint**
   - Pi config/package/session backup before major self-updates

3. **Workspace checkpoint**
   - git state or snapshot before risky autonomous changes

This fits the worker’s goal of controlled failure. If Pi breaks itself, recovery should be a documented path, not a heroic debugging session.

## 6. Control plane should remain distinct from client surface

Open Agents is web-first on the outside, but its useful contribution is deeper than its web app. The browser enters through `apps/web/app/api/chat/route.ts`, but the real design lesson is that client surface is separate from runtime core.

### Why this matters for self-healing

Theo explicitly wants alternative control surfaces such as Telegram later. That means the worker should not be designed as “a web app with Pi hidden behind it.” It should be designed as:

- Pi runtime core
- thin gateway(s)
- optional client channels on top

### What to import into the Pi worker vision

Adopt a client-agnostic mental model:

```text
Telegram / SSH / future web / scripts
  -> gateway/control interface
  -> Pi runtime
  -> workspace execution interface
```

This keeps Theo’s SSH-first operations intact while leaving space for other control channels later.

## 7. Keep host and worker boundaries hard

Open Agents exists largely because the authors do not want agent execution glued to one request process or one machine context. That is consistent with Theo’s own blast-radius concerns in the worker design.

### Why this matters for self-healing

The current worker design already rejects “just run Pi on macOS host.” Open Agents supports that instinct. The right lesson is not merely “use Vercel sandboxes.” The right lesson is:

- keep the operator environment distinct from the agent environment
- keep the agent runtime distinct from work execution where possible
- keep secrets scoped to the runtime that actually needs them

### What to import into the Pi worker vision

Strengthen the current isolation guidance:

- do not let Pi inherit Theo’s normal macOS identity
- keep dedicated credentials inside the VM only
- keep work inside bounded directories
- prepare for future stronger task isolation inside the VM

## What Open Agents does **not** give us directly

It is also important to be clear about what should **not** be imported blindly.

### 1. We do not need the full web stack

Open Agents’ Next.js app, browser streaming format, and chat UI are not necessary for the current self-healing Pi worker. Theo’s current operational model is SSH + `tmux`, and that remains the right primary interface.

### 2. We do not need Vercel-specific infrastructure today

Vercel Workflow and Vercel Sandbox are good references, but they are not requirements for Phase 1 of the personal worker. The local Linux VM should stay simple enough to debug directly.

### 3. Open Agents does not solve self-modifying Pi runtime policy

The hardest part of Theo’s vision is not web transport. It is safe self-healing and self-updating. Open Agents does not provide a ready-made policy for:

- when Pi may modify itself
- how self-update is validated
- when rollback is triggered
- how to distinguish repair from uncontrolled drift

That policy remains Theo-specific and must be designed directly.

## Concrete Recommendations for Theo’s Worker Documents

## A. Amend the design doc with explicit runtime layers

In `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`, strengthen the design by explicitly naming these layers inside the VM:

- operator layer
- Pi runtime layer
- workspace execution layer

This makes the document more future-proof and more aligned with Open Agents’ strongest architectural idea.

## B. Add a small internal workspace execution interface early

In implementation planning, add a simple abstraction for workspace operations even if the first implementation only targets local VM directories.

That will reduce redesign cost later if Theo introduces:

- per-project containers
- Incus/LXC
- remote task runners
- hosted execution

## C. Treat health and reconnect as core features

Do not postpone health and restart semantics until after full automation. Even the SSH + `tmux` version should gain simple explicit checks, such as:

- worker health script
- active session listing
- last-heartbeat marker
- restart helper

## D. Make snapshot/checkpoint policy explicit

The current documents mention snapshots, but Open Agents suggests making them part of the normal operating model. Add explicit guidance for:

- baseline VM snapshot
- pre-upgrade worker checkpoint
- pre-risk workspace checkpoint

## E. Keep gateways thin and optional

If Telegram or another control surface arrives later, it should sit on top of the Pi runtime rather than replacing the SSH-first operational model too early.

## Proposed Runtime Model After Importing Open Agents Lessons

For the local VM worker, the revised target operating model becomes:

```text
Theo/operator access
  -> SSH / tmux / helper scripts
  -> Pi runtime inside Linux VM
  -> bounded workspace execution interface
  -> project workspaces (and later task sandboxes)
```

For a later hosted or more autonomous version, that naturally evolves toward:

```text
External client/gateway
  -> worker control plane
  -> Pi runtime
  -> isolated workspace execution backend
```

That evolution path is exactly why Open Agents is useful here: not because we need its product surface today, but because it demonstrates durable architectural boundaries.

## Bottom Line

The most important Open Agents lesson for the self-healing Pi worker is this:

> Do not design the worker as one big mutable box. Design it as explicit layers with separate lifecycles, explicit execution boundaries, and normal recovery paths.

That principle supports every core goal in Theo’s worker design:

- bounded blast radius
- restartability
- observability
- migration readiness
- future support for stronger sandboxing
- future support for alternate control channels

Open Agents should therefore be treated as an architectural reference for **separation, reconnectability, and sandbox abstraction**.

It should **not** be treated as proof that Theo needs a web UI first or Vercel deployment first.
