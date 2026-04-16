# Pi Task Loop Implementation Plan

## Objective

Implement phase-1 `pi-task-loop` as a Pi extension package in this repo.

## Milestones

### 1. Package scaffold
- create `packages/pi-task-loop/package.json`
- create `packages/pi-task-loop/README.md`
- create `packages/pi-task-loop/extensions/task-loop.ts`
- add package extension path to repo root `package.json`
- mention package in root `README.md`

### 2. State helpers
- read/write `.agent/loop-state.json`
- read/write `.agent/loop-context.md`
- create `.agent/` directory if missing
- parse duration input for interval command

### 3. Loop commands
- `/task-loop on`
- `/task-loop off`
- `/task-loop once`
- `/task-loop status`
- `/task-loop interval <duration>`
- `/task-loop context <text>`

### 4. Timer runtime
- arm timer when loop active
- restore timer on `session_start`
- clear timer on disable and shutdown
- schedule next tick after each agent run

### 5. Tick injection
- queue compact continuation prompt with `pi.sendUserMessage`
- use `deliverAs: "followUp"` when agent busy
- inject extra system guidance during loop-generated turns only
- include optional operator context from `.agent/loop-context.md`

### 6. Stop logic
- parse `.agent/tasks.json`
- stop if every task is `done`
- stop if task file missing or malformed only when operator explicitly disables? no — phase 1 should continue but warn in status
- record stop reason in state

### 7. Verification
- type/syntax smoke check with `npx tsx packages/pi-task-loop/extensions/task-loop.ts`
- verify JSON files written in temp repo
- manually inspect command strings and state transitions

## Notes

- Use quiet footer status only in phase 1.
- Keep prompt small; no Ralph-style large repeated template.
- Favor established-work continuation semantics over checklist-promise semantics.
