# AGENTS.md

Local Pi rules for this repo.

- Prefer autonomous local/reversible work; ask only for credentials, destructive/external side effects, or product decisions.
- Verify meaningful code changes with targeted tests/build/lint when feasible.
- Keep `.agent/progress.md` and task-loop state accurate for multi-turn work; use task-loop tooling as source of truth.
- Outside the `theo-pi` VM only, prefer `claude-acpx` subagents for reviews, parallel deep-thinking, and web research; the VM lacks Claude Code access.
- For Claude delegation details, load skill `claude-code-acpx-subagent`.
- Use Graphite CLI (`gt`) for branches/PRs: new idea = new stack branch; same idea = stay on current branch and amend/submit.
