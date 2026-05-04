# pi-task-loop

Pi-native autonomous continuation loop for established repo work.

## Phase 1 features
- timer-driven continuation ticks
- persistent state in `.agent/loop-state.json`
- canonical active-task state managed by `task_loop_tasks`
- optional operator hints in `.agent/loop-context.md`
- commands for on/off/once/status/interval/context
- quiet footer status
- stop when active task list becomes empty

## Install

### From repo root

```bash
pi install /absolute/path/to/theo-pi
```

### Package only

```bash
pi install /absolute/path/to/theo-pi/packages/pi-task-loop
```

Reload if Pi already running:

```text
/reload
```

## Commands

```text
/task-loop on
/task-loop off
/task-loop once
/task-loop status
/task-loop interval 15m
/task-loop context focus on task-14 first
```

## State files

- `.agent/loop-state.json`
- `.agent/loop-context.md`
- `.agent/tasks.json`
- `.agent/tasks-history.json`

## Current behavior

When loop is on, the extension schedules a timer. On each tick it sends a compact continuation prompt telling Pi to resume established work from `.agent/progress.md` and canonical task state managed by `task_loop_tasks`. Concluding the current batch archives tasks to `.agent/tasks-history.json` and clears the active list. If the loop stops because all remaining tasks are already `done`, it now auto-archives that completed list and clears `.agent/tasks.json` for you.

`task_loop_tasks` is intentionally forgiving on input shape so first-tick tool use succeeds more often. It accepts common aliases like `add`, `update`, `complete`, `finish`, `replace`, `taskId`, `task_id`, `name`, nested `task`, and status variants like `in-progress` or `completed`.

Phase 1 keeps state and scheduling local to the current Pi runtime. Event monitors and loop history can come later.

## Smoke check

```bash
cd /absolute/path/to/theo-pi
npx tsx packages/pi-task-loop/extensions/task-loop.ts
```

## Dogfood E2E

```bash
cd /absolute/path/to/theo-pi
npm run dogfood:e2e --workspace packages/pi-task-loop
```
