---
name: claude-code-acpx-subagent
description: Delegate repo tasks asynchronously to Claude Code via ACPX from a Pi subagent, returning Claude's final answer directly in get_subagent_result. Use when asked to run Claude Code as a subagent, review code with Claude, or fan out Claude Code work through ACP/XACP.
---

# Claude Code ACPX Subagent

Use this when delegating coding or review work to Claude Code through ACPX from Pi subagents.

## Default flow

1. Start a background subagent of type `claude-acpx`.
2. Use `--format quiet` so Claude's final assistant answer becomes subagent output.
3. Allow Claude to edit when task asks for implementation or fixes.
4. Require Claude to report changed files and verification.
5. Retrieve result with `get_subagent_result({ agent_id, wait: true })`.

```ts
Agent({
  subagent_type: "claude-acpx",
  description: "Claude review",
  prompt: `Run this command in /path/to/repo:

npx acpx@0.7.0 --cwd /path/to/repo --format quiet --timeout 600 --approve-reads claude exec "Review current changes. If fixes are needed, edit files. Report changed files, verification, and remaining risks."`,
  run_in_background: true,
  max_turns: 3,
})
```

## Permission choices

- Review only: `--deny-all` or `--approve-reads`.
- Implementation/fixes: `--approve-reads` first; use `--approve-all` only when user explicitly wants autonomous edits and repo-local side effects are acceptable.
- Always include: `Report changed files, verification, and remaining risks.`

## Do not smoke test by default

Do not run marker smoke tests before every delegation. They add latency. Smoke-test only when:

- ACPX/Claude invocation fails,
- auth/session state looks broken,
- adapter was upgraded or changed,
- output does not appear in `get_subagent_result`.

Smoke command if needed:

```bash
npx acpx@0.7.0 --cwd /path/to/repo --format quiet --timeout 60 --deny-all claude exec "Reply with exactly: claude-acp-ok"
```

## Pitfalls

- ACPX global flags go before `claude exec`; `acpx claude exec --cwd ...` fails.
- `--format text` includes tool logs and can cause subagent final answer to say `shown above`; use `--format quiet` for result-return UX.
- `get_subagent_result({ verbose: true })` truncates tool results; do not rely on it to recover large stdout.
- Use absolute `--cwd`, because subagent cwd may differ.
- Parallel calls need distinct ACPX/session identifiers if wrapper defaults share one chat/session.

## Expected result

`get_subagent_result` should contain Claude's final answer directly, including changed files and verification when edits were allowed.
