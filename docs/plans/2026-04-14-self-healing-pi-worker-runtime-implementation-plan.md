# Self-Healing Pi Worker Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve Theo’s personal autonomous Pi worker into a supervised, health-checked, restartable runtime that keeps SSH + `tmux` as the primary operator interface while importing key architectural lessons from Open Agents and ClawRun.

**Architecture:** Keep the local Linux VM as the agent machine. Add explicit runtime layers inside the VM: operator layer, lightweight supervisor layer, Pi runtime layer, and workspace execution layer. Borrow Open Agents’ separation and execution-interface discipline, and ClawRun’s sidecar/supervisor, health, and heartbeat ideas.

**Tech Stack:** Ubuntu Server VM, SSH, `tmux`, Node.js, `pi-coding-agent`, Theo Pi packages, shell scripts, TypeScript/Node helpers, local files for state markers, optional future HTTP health endpoint.

---

## Task 1: Patch worker design doc with runtime layer model

**Files:**
- Modify: `docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md`
- Reference: `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`
- Reference: `docs/plans/2026-04-14-clawrun-lessons-for-self-healing-pi-worker.md`
- Reference: `docs/plans/2026-04-14-open-agents-vs-clawrun-for-self-healing-pi-worker.md`

**Step 1: Write the failing diff objective**

Add explicit internal runtime layers:
- operator layer
- supervisor layer
- Pi runtime layer
- workspace execution layer

**Step 2: Update architecture section**

Add a short diagram like:

```text
Theo/operator -> SSH/tmux -> supervisor -> Pi runtime -> workspace execution
```

**Step 3: Add rationale**

Explain that:
- Open Agents motivates separation of control/runtime/execution
- ClawRun motivates supervisor-managed liveness

**Step 4: Verify doc coherence**

Read the full updated document and confirm it still matches the local-VM-first strategy.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-personal-autonomous-pi-worker-design.md
git commit -m "docs: add runtime layer model to pi worker design"
```

---

## Task 2: Patch worker implementation plan with supervisor and health phases

**Files:**
- Modify: `docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md`
- Reference: `docs/plans/2026-04-14-clawrun-lessons-for-self-healing-pi-worker.md`
- Reference: `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`

**Step 1: Write the failing diff objective**

Add missing implementation concerns:
- lightweight supervisor
- health output
- heartbeat markers
- explicit runtime state files
- workspace execution abstraction placeholder

**Step 2: Insert new phase**

Add a phase after the basic `tmux` setup for runtime supervision and observability.

**Step 3: Add concrete verification items**

Add checks for:
- worker health command
- restart path after Pi crash
- heartbeat timestamp freshness
- supervisor log location

**Step 4: Verify doc coherence**

Read full updated plan and make sure it still remains incremental and does not prematurely force hosted deployment.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-personal-autonomous-pi-worker-implementation-plan.md
git commit -m "docs: extend pi worker implementation plan with runtime supervision"
```

---

## Task 3: Create worker runtime ADR for supervised Pi model

**Files:**
- Create: `docs/plans/2026-04-14-supervised-pi-runtime-adr.md`
- Reference: `docs/plans/2026-04-14-open-agents-vs-clawrun-for-self-healing-pi-worker.md`

**Step 1: Write ADR skeleton**

Include:
- context
- decision
- consequences
- non-goals

**Step 2: Record decision**

Decision should state:
- local Linux VM remains primary environment
- Pi is supervised by a lightweight runtime manager
- SSH + `tmux` remain primary operator path
- future Telegram/web gateways are optional control surfaces on top, not replacements

**Step 3: Add consequences**

Document trade-offs:
- more moving parts than raw `tmux`
- much better liveness, health, and restart semantics
- easier future migration to hosted runtime

**Step 4: Review for clarity**

Ensure document is short and decision-oriented.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-supervised-pi-runtime-adr.md
git commit -m "docs: add supervised pi runtime adr"
```

---

## Task 4: Create runtime state layout spec

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-runtime-state-layout.md`

**Step 1: Write the file layout**

Document proposed persistent runtime state paths, for example:

```text
~/.pi-worker/
  state.json
  heartbeat.json
  health.json
  supervisor.log
  bootstrap-version
  checkpoints/
```

**Step 2: Define each file’s purpose**

Specify meanings for:
- current runtime state
- last heartbeat
- restart count
- active workspace/session
- checkpoint metadata

**Step 3: Define update rules**

Document who writes each file and when.

**Step 4: Define recovery usage**

Document how an operator uses these files during recovery.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-runtime-state-layout.md
git commit -m "docs: define pi worker runtime state layout"
```

---

## Task 5: Create lightweight supervisor script spec

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-supervisor-spec.md`

**Step 1: Describe responsibilities**

Specify that the supervisor must:
- start Pi in a target workspace/session
- detect failure
- restart with capped retries
- update health/heartbeat state
- write logs

**Step 2: Define minimum interface**

Document commands like:
- `pi-worker-supervisor start <session> <workspace>`
- `pi-worker-supervisor status`
- `pi-worker-supervisor restart <session>`
- `pi-worker-supervisor stop <session>`

**Step 3: Define readiness model**

Explain what counts as “healthy enough” in the first version.

**Step 4: Define failure model**

Explain restart limits, backoff, and when operator intervention is required.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-supervisor-spec.md
git commit -m "docs: specify pi worker supervisor behavior"
```

---

## Task 6: Create worker health contract spec

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-health-contract.md`

**Step 1: Define health fields**

Document health output fields such as:
- `ok`
- `daemonStatus`
- `sessionName`
- `workspacePath`
- `pid`
- `restartCount`
- `lastHeartbeatAt`
- `lastSuccessAt`

**Step 2: Define output forms**

Support at least:
- human-readable CLI output
- machine-readable JSON

**Step 3: Define stale/unhealthy conditions**

Document simple rules for stale heartbeat and failed runtime.

**Step 4: Define future extension points**

Reserve fields for future gateway/channel use.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-health-contract.md
git commit -m "docs: define pi worker health contract"
```

---

## Task 7: Create workspace execution interface spec

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-workspace-execution-interface.md`
- Reference: `docs/plans/2026-04-14-open-agents-lessons-for-self-healing-pi-worker.md`

**Step 1: Define minimal operations**

Document operations:
- read
- write
- edit
- exec
- list/search
- checkpoint

**Step 2: Define local VM implementation**

State that v1 maps directly to bounded directories under `~/workspaces`.

**Step 3: Define future backend replacements**

Reserve path for:
- per-project containers
- remote task runners
- Vercel sandbox experiments

**Step 4: Review for simplicity**

Keep interface intentionally small.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-workspace-execution-interface.md
git commit -m "docs: define worker workspace execution interface"
```

---

## Task 8: Create gateway and wake-hook placeholder spec

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-gateway-and-wake-hooks.md`
- Reference: `docs/plans/2026-04-14-clawrun-lessons-for-self-healing-pi-worker.md`

**Step 1: Define non-goal for immediate phase**

Document that Telegram/web gateway is not Phase 1 delivery.

**Step 2: Define reserved architecture slot**

Document future layers:
- validators
- wake hooks
- normalized control signals
- runtime gateway

**Step 3: Define expected first gateway shape**

Document likely simplest future gateway:
- `POST /run`
- `GET /health`

**Step 4: Keep it explicitly optional**

Make sure SSH-first operation remains primary for now.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-gateway-and-wake-hooks.md
git commit -m "docs: reserve worker gateway and wake hook architecture"
```

---

## Task 9: Write verification checklist for supervised runtime milestone

**Files:**
- Create: `docs/plans/2026-04-14-pi-worker-supervised-runtime-verification.md`

**Step 1: Define operator checks**

Checklist should include:
- SSH reconnect works
- `tmux` session visible
- supervisor status visible
- health output correct

**Step 2: Define failure injection checks**

Checklist should include:
- manually kill Pi process
- verify supervisor restarts it
- verify restart count increments
- verify health output changes appropriately

**Step 3: Define checkpoint checks**

Checklist should include:
- heartbeat file updates
- state file reflects active workspace
- checkpoint metadata exists before risky update

**Step 4: Define success criteria**

State what counts as a successful supervised-runtime milestone.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-pi-worker-supervised-runtime-verification.md
git commit -m "docs: add supervised runtime verification checklist"
```

---

## Task 10: Review all worker docs for alignment

**Files:**
- Modify if needed: all docs above
- Reference: full `docs/plans/2026-04-14-*pi-worker*.md` set

**Step 1: Read all worker-related docs together**

Check for contradictions between:
- original worker design
- original implementation plan
- Open Agents lessons
- ClawRun lessons
- comparison doc
- new runtime docs

**Step 2: Resolve naming drift**

Make sure terms like “worker,” “runtime,” “supervisor,” “workspace execution,” and “gateway” are used consistently.

**Step 3: Confirm incremental delivery**

Ensure Phase 1 still remains realistic for a local VM.

**Step 4: Capture any final edits**

Make small doc edits only as needed.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-*.md
git commit -m "docs: align self-healing pi worker runtime plans"
```

---

## Notes for execution

- Preserve SSH + `tmux` as the primary operator experience.
- Do not over-rotate into hosted architecture too early.
- Import Open Agents mainly for boundary and execution-interface ideas.
- Import ClawRun mainly for supervisor, health, heartbeat, and wake-hook ideas.
- Keep Telegram and other channels as future optional layers, not current blockers.
- Prefer explicit state files and procedural recovery over implicit process memory.
- Design all new runtime semantics so they can later be implemented as code in `theo-pi` scripts or a new subpackage.
