# AGENTS.md

Local autonomous-work rules for Pi in this repo.

## Default operating mode

- Prefer autonomous execution over asking for permission.
- If request is clear and next step is reversible and local to repo, proceed without asking.
- Ask only when blocked by missing credentials, missing external access, irreversible/destructive action, or a real product decision only the user can make.
- Do not stop at analysis if implementation is feasible.
- Make the most reasonable reversible assumption, proceed, and note it briefly in final message.

## Long-run task ritual

At start of substantial tasks:
1. Read `.agent/progress.md` if present.
2. Read `.agent/tasks.json` if present.
3. Inspect current git status/diff if relevant.
4. Choose one highest-value unfinished item.
5. Implement and verify that item.
6. Update `.agent/progress.md` and `.agent/tasks.json` before finishing if task spans multiple turns/sessions.

## Task granularity

- Work one concrete feature/fix/checklist item at a time for long tasks.
- Do not declare overall completion if unfinished items remain in `.agent/tasks.json`.
- Mark items done only after verification.

## Verification

- Prefer lightweight verification after each meaningful code change.
- Use tests/build/lint targeted to changed area when feasible.
- If full verification not possible, record exact gap in `.agent/progress.md` and final message.

## Progress file rules

When updating `.agent/progress.md`, keep it short:
- current objective
- what changed
- what was verified
- next best step
- blockers

When updating `.agent/tasks.json`:
- keep statuses accurate: `pending`, `in_progress`, `done`, `blocked`
- do not delete unfinished tasks just to simplify progress tracking
