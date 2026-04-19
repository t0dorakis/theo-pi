# Pi Task Loop Design

## Goal

Add a Pi-native autonomous task loop package that keeps working on established repo tasks with minimal TUI noise and without repeated user nudges.

## Problem

Prompt tuning alone improves follow-through, but it does not give Pi a real scheduler, persistent loop state, or explicit stop conditions. Existing Ralph-style loops prove the extension model works, but they over-index on repeated prompts and promise-tag completion.

## Approaches

### 1. Prompt-only autonomy
- Pros: lowest implementation cost
- Cons: no timer, no state machine, no explicit resume/stop semantics, no reliable quiet loop behavior

### 2. Ralph-style repeated prompt loop in Pi
- Pros: proven pattern, simple to reason about, existing extension examples
- Cons: repeats large prompts, weaker notion of established-work continuation, completion depends too much on model discipline

### 3. Pi-native task loop with short continuation ticks
- Pros: matches Claude-style steward loop, uses repo state files, supports quiet status UI, explicit stop rules, future event monitors
- Cons: more extension code and state management

## Recommendation

Choose approach 3.

Use a Pi extension package `pi-task-loop` that:
- stores loop state in `.agent/loop-state.json`
- optionally stores operator hints in `.agent/loop-context.md`
- wakes on timer
- injects a short continuation prompt instead of replaying a huge loop prompt
- reads `.agent/tasks.json` and `.agent/progress.md` on each tick
- stops when tasks are done, only blocked work remains, or no actionable work is found

## Architecture

### Package
- `packages/pi-task-loop`
- exported as normal Pi package extension

### Core files
- `extensions/task-loop.ts` — extension entry and runtime
- `README.md` — install and command usage
- `package.json` — Pi package metadata

### Runtime state
- `.agent/loop-state.json`
- `.agent/loop-context.md`

Suggested state shape:

```json
{
  "version": 1,
  "active": true,
  "iteration": 3,
  "intervalSeconds": 900,
  "lastTickAt": "2026-04-15T12:00:00.000Z",
  "nextTickAt": "2026-04-15T12:15:00.000Z",
  "lastPrompt": "short summary",
  "lastStopReason": null
}
```

## Loop semantics

Each tick should behave like an autonomous continuation check:
1. inspect `.agent/tasks.json`
2. inspect `.agent/progress.md`
3. continue highest-value established unfinished work
4. avoid asking unless blocked by irreversible action, external side effect, missing credentials, or real product choice
5. update repo state files before stopping

The extension should not force a giant repeated task prompt. It should send a compact continuation instruction.

## Commands

- `/task-loop on`
- `/task-loop off`
- `/task-loop once`
- `/task-loop status`
- `/task-loop interval <duration>`
- `/task-loop context <text>`

## Tick prompt contract

The extension sends a short user message like:

```text
Autonomous continuation tick.
Resume established work only.
Read `.agent/progress.md` and `.agent/tasks.json` first.
Choose highest-value unfinished work already implied by repo state.
Continue without asking unless blocked by irreversible action, external side effect, missing credentials, or a real product/business choice.
Update `.agent/progress.md` and `.agent/tasks.json` before stopping.
Keep commentary minimal.
```

If `.agent/loop-context.md` exists, append it as operator context.

## Stop conditions

Stop loop when:
- all tasks are `done`
- no unfinished actionable tasks remain
- loop is manually turned off

Later versions should also stop on repeated no-progress or repeated identical blockers.

## UI behavior

Keep status light:
- footer status only
- no big widgets by default
- no chatty notifications except command results and stop reasons

Example status:
- `loop:on i3 15m`
- `loop:off done`

## Phase 1 scope

Phase 1 should implement:
- persistent state file
- timer-based scheduling in current Pi runtime
- commands for on/off/once/status/interval/context
- quiet continuation prompt injection
- simple task completion stop logic based on `.agent/tasks.json`

## Future phases

Phase 2:
- event monitors plus fallback timer
- no-progress detection
- blocker detection
- session-aware continuation summaries

Phase 3:
- branch/CI/test watchers
- richer status widget
- optional loop history file
