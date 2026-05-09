# Codex `/goal` vs `pi-task-loop`

## Goal

Compare OpenAI Codex's persisted `/goal` workflow with this repo's `pi-task-loop` extension and choose the safest next improvement.

## Sources

- OpenAI Codex 0.128.0 release notes: persisted `/goal` workflows with app-server APIs, model tools, runtime continuation, and TUI controls for create, pause, resume, and clear.
  - https://github.com/openai/codex/releases/tag/rust-v0.128.0
- Goal implementation PR stack:
  - foundation: https://github.com/openai/codex/pull/18073
  - app-server API: https://github.com/openai/codex/pull/18074
  - model tools: https://github.com/openai/codex/pull/18075
  - core runtime: https://github.com/openai/codex/pull/18076
  - TUI UX: https://github.com/openai/codex/pull/18077
- Local implementation:
  - `packages/pi-task-loop/extensions/task-loop.ts`
  - `packages/pi-task-loop/README.md`
  - `docs/plans/2026-04-15-pi-task-loop-design.md`

## What Codex `/goal` Adds

Codex `/goal` is a runtime-level objective primitive, not just a task list.

Key properties from the official release/PR set:

- durable goal persistence tied to the thread/session model
- explicit lifecycle controls: create, pause, resume, clear
- app-server get/set/clear APIs
- constrained model tools for reading, creating, and completing goals
- runtime continuation while the goal is active
- pause/resume behavior around interruptions
- budget accounting and `budget_limited` stop behavior
- suppression of unproductive continuation cases such as no-tool-call loops
- TUI goal status and summary

## What `pi-task-loop` Does Today

`pi-task-loop` is an extension-level autonomous continuation loop for established repo tasks.

Current behavior:

- stores timer/runtime state in `.agent/loop-state.json`
- stores active checklist state in `.agent/tasks.json`
- stores operator hints in `.agent/loop-context.md`
- wakes on a timer or `/task-loop once`
- injects a compact continuation prompt
- asks the model to read `.agent/progress.md` and use `task_loop_tasks`
- stops when no active tasks remain
- archives completed task batches to `.agent/tasks-history.json`
- renders light TUI status/widget state

This is useful, but it is not the same abstraction as `/goal`.

## Main Difference

Codex `/goal` makes the objective the durable source of truth. Tasks and tool calls are execution detail.

`pi-task-loop` makes `.agent/tasks.json` the durable source of truth. The timer and prompt keep the agent moving through that task list.

That difference matters because a direct `/goal` clone would create two competing liveness authorities:

- objective says "keep pursuing this"
- tasks say "stop when no active task exists"

Until that invariant is resolved, adding a broad goal lifecycle would be risky.

## Subagent Review Summary

Proposal agents converged on adding a durable objective layer inspired by `/goal`.

The grill pass blocked a broad implementation for these reasons:

- objective liveness currently conflicts with task liveness
- v2 state migration could silently drop new fields without dedicated tests
- `active` plus `active/paused/complete/budget_limited` lifecycle would confuse command semantics
- `clear` is under-specified and could become a data-loss command
- `maxIterations` has off-by-one risks around when `iteration` increments
- adding a second model-writable goal tool would create another state authority
- current package has dogfood E2E coverage but no deterministic state-machine tests

Claude Code proposal passes were attempted through ACPX, but the local environment returned `Internal error: Credit balance is too low`. Built-in subagents completed the proposal and grill review.

## Recommendation

Do not implement a full `/goal` clone in `pi-task-loop` yet.

The best next step is a staged alignment plan:

1. Document the semantic mapping between `/goal` and `pi-task-loop`.
2. Add deterministic state/prompt tests before changing the state machine.
3. Land a minimal objective foundation only after the liveness invariant is explicit.
4. Defer idle-runtime continuation, token budgets, no-tool-call suppression, and broad TUI controls until Pi exposes reliable runtime hooks or the state model is hardened.

## Proposed Next Code PR

Name: `feat: add task-loop objective foundation`

Scope:

- Keep `.agent/tasks.json` as the liveness authority for the first code PR.
- Add optional objective metadata to `.agent/loop-state.json`.
- Do not add pause/resume/clear yet.
- Do not add token budgets yet.
- Do not add a model-writable create/clear goal tool yet.

Data shape:

```ts
type LoopObjective = {
  text: string;
  status: "active" | "complete";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completionReason?: string;
};

type LoopState = {
  version: 2;
  active: boolean;
  iteration: number;
  intervalSeconds: number;
  lastTickAt?: string;
  nextTickAt?: string;
  lastPrompt?: string;
  lastStopReason?: string | null;
  objective?: LoopObjective;
};
```

Commands:

```text
/task-loop objective <text>
/task-loop objective
/task-loop objective complete [reason]
```

Rules:

- `objective <text>` records durable purpose but does not replace tasks as the stop condition.
- `objective complete` marks only the objective complete; it does not archive or delete tasks.
- `/task-loop on/off/once/status/interval/context` keep their current behavior.
- Status and tick prompts include the objective when present.
- `task_loop_tasks` remains the only model tool for active task mutation in the first code PR.

Tests before or with the code PR:

- v1 loop-state migrates to v2 without losing existing fields
- unknown fields are preserved or intentionally rejected with a clear migration rule
- objective is included in tick prompt
- objective status appears in `/task-loop status`
- completing an objective does not delete tasks
- empty tasks still stop the loop even when objective exists, until a later PR explicitly changes liveness

## Deferred Work

After the objective foundation is tested:

- decide whether objective or tasks should be authoritative for liveness
- add pause/resume only after mapping them clearly against `on/off`
- add `clear` only with explicit archive/delete semantics
- add iteration/time budget with exact off-by-one tests
- add no-tool-call suppression only if reliable tool-call telemetry is available
- add a constrained `task_loop_goal` model tool only after objective/task ownership is settled
- consider runtime-idle continuation only after no-progress safeguards exist

## Acceptance Criteria For This Plan

- The distinction between Codex `/goal` and `pi-task-loop` is explicit.
- The first code PR is small enough to review safely.
- No existing task-loop behavior is broken.
- Future `/goal`-like features have a dependency order that avoids duplicate state authorities.
