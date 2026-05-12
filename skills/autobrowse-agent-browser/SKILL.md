---
name: autobrowse-agent-browser
description: Self-improving browser automation using agent-browser. Use when you want an agent to learn a repeatable browser workflow for a specific website task, iterate on strategy.md from traces, then graduate durable site-specific skills into this repo or ~/.agents/skills.
compatibility: "Requires Node.js 18+, ACPX, and agent-browser CLI. No ANTHROPIC_API_KEY is used by this harness; model access is delegated through ACPX (default: claude). Run npm install in skills/autobrowse-agent-browser before first use."
---

# AutoBrowse Agent Browser

Build reliable browser automation skills through iterative experimentation using `agent-browser` instead of Browserbase `browse`. Inner agent execution routes through ACPX, not direct Anthropic SDK/API keys. See `README.md` for full operator guide.

## Source directory

Repo source lives at:

```bash
skills/autobrowse-agent-browser
```

If installed globally, use:

```bash
export AUTOBROWSE_AGENT_BROWSER_DIR="${AUTOBROWSE_AGENT_BROWSER_DIR:-$PWD/skills/autobrowse-agent-browser}"
```

## Setup

```bash
export AUTOBROWSE_AGENT_BROWSER_DIR="${AUTOBROWSE_AGENT_BROWSER_DIR:-$PWD/skills/autobrowse-agent-browser}"
cd "$AUTOBROWSE_AGENT_BROWSER_DIR"
npm install
command -v agent-browser || npm install -g agent-browser
agent-browser install # downloads browser runtime; may need extra disk/network access
```

No `ANTHROPIC_API_KEY` is required. Configure ACPX/Claude Code auth the same way this repo's ACPX delegation does.

## Workflow

1. Create workspace:

```bash
mkdir -p ./autobrowse/tasks ./autobrowse/traces ./autobrowse/reports
```

2. Create task:

```bash
TASK=<short-kebab-name>
mkdir -p ./autobrowse/tasks/$TASK
cp "$AUTOBROWSE_AGENT_BROWSER_DIR/references/example-task.md" ./autobrowse/tasks/$TASK/task.md
$EDITOR ./autobrowse/tasks/$TASK/task.md
```

3. Run one evaluation:

```bash
node "$AUTOBROWSE_AGENT_BROWSER_DIR/scripts/evaluate.mjs" --task "$TASK" --workspace ./autobrowse
# optional: --agent claude --timeout 1200 --deny-all
```

4. Read trace:

```bash
cat ./autobrowse/traces/$TASK/latest/summary.md 2>/dev/null || ls -t ./autobrowse/traces/$TASK/run-*/summary.md | head -1 | xargs cat
```

5. Update only `./autobrowse/tasks/$TASK/strategy.md` with one concrete improvement, then rerun.

6. Stop after 3-5 iterations or when 2 of last 3 runs pass.

## agent-browser command rules for learned strategies

Use these primitives in generated strategies:

```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "value"
agent-browser keyboard type "text"
agent-browser press Enter
agent-browser scroll down 500
agent-browser screenshot traces/task/screenshots/step-01.png
agent-browser get url
agent-browser get title
agent-browser get text body
agent-browser eval 'document.title'
agent-browser close
```

Refs are `@eN`, not Browserbase `[0-5]`. Always snapshot after navigation and after each DOM-changing action. Harness injects a unique `agent-browser --session ...` name for parallel-safe runs.

## Graduation

When stable, write a self-contained skill to either:

- `skills/<task-name>/SKILL.md` if source should be committed in this repo.
- `~/.agents/skills/<task-name>/SKILL.md` for local-only use.

Graduated skill must include purpose, trigger conditions, exact workflow, site-specific gotchas, failure recovery, and expected JSON output.

## Pitfalls

- Do not use Browserbase `browse` commands or `[X-Y]` refs.
- Do not edit `task.md` during iteration except initial creation.
- Do not repeat failed actions; read trace, form one hypothesis, patch `strategy.md`.
- Harness uses ACPX `--approve-all` by default so delegated Claude can browse and write trace artifacts; run only in trusted workspaces.
- Treat `./autobrowse/traces/` as sensitive; snapshots and messages may contain page text or authenticated data; repo root `autobrowse/` is gitignored as a backstop.
- Prefer deterministic `agent-browser eval` extraction when visible text is insufficient.
