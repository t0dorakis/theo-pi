# autobrowse-agent-browser

Repo-backed skill for learning repeatable browser workflows with `agent-browser`, while delegating model execution through ACPX instead of direct provider API keys.

Fork/provenance: inspired by and partially derived from Browserbase's MIT-licensed Autobrowse skill, then adapted for Pi, ACPX, and `agent-browser`.

## Why this exists

Browser agents often rediscover site behavior on every run. This harness turns exploration into durable memory:

1. Define a real browser task in `autobrowse/tasks/<task>/task.md`.
2. Run an ACPX-backed agent that uses `agent-browser` to complete the task.
3. Inspect `autobrowse/traces/<task>/latest/summary.md`.
4. Patch only `strategy.md` with one concrete improvement.
5. Repeat until stable, then graduate a standalone `SKILL.md`.

## Key design choices

- **No direct `ANTHROPIC_API_KEY`**: execution routes through `npx acpx ... claude exec` by default.
- **Local file writes allowed**: delegated agent may write screenshots, notes, and extracted data under trace/workspace dirs.
- **Web browsing allowed**: delegated agent may use `agent-browser` for live web tasks.
- **Parallel-safe sessions**: harness assigns each run a unique `agent-browser --session autobrowse-<task>-<run>`.
- **Traceable runs**: each run stores `prompt.md`, `output.txt`, `summary.md`, optional `error.txt`, and screenshot dir.

## Setup

```bash
export AUTOBROWSE_AGENT_BROWSER_DIR="${AUTOBROWSE_AGENT_BROWSER_DIR:-$PWD/skills/autobrowse-agent-browser}"
cd "$AUTOBROWSE_AGENT_BROWSER_DIR"
npm install
command -v agent-browser || npm install -g agent-browser
agent-browser install # downloads browser runtime; may need extra disk/network access
```

ACPX/Claude auth must already work in the environment. Quick smoke uses `--deny-all` because it does not need tool execution; real harness runs default to `--approve-all` so Claude can browse and write trace artifacts.

```bash
npx acpx@0.7.0 --cwd "$PWD" --format quiet --timeout 60 --deny-all claude exec "Reply exactly: acpx-ok"
```

## Create and run a task

```bash
WORK=/tmp/autobrowse-demo
TASK=morgenpost-news
mkdir -p "$WORK/autobrowse/tasks/$TASK"
cp skills/autobrowse-agent-browser/references/example-task.md "$WORK/autobrowse/tasks/$TASK/task.md"
$EDITOR "$WORK/autobrowse/tasks/$TASK/task.md"
cat > "$WORK/autobrowse/tasks/$TASK/strategy.md" <<'EOF'
# Navigation Skill

Start broad. Prefer deterministic DOM/text extraction over clicking unless the site requires interaction.
EOF

node skills/autobrowse-agent-browser/scripts/evaluate.mjs \
  --task "$TASK" \
  --workspace "$WORK/autobrowse" \
  --timeout 900
```

Read result:

```bash
cat "$WORK/autobrowse/traces/$TASK/latest/summary.md"
```

## Iteration discipline

- Edit `strategy.md`, not `task.md`, after first run.
- Change one hypothesis per run.
- Preserve what worked; remove wasted steps.
- Prefer `agent-browser eval` or `get text body` for extraction when UI interaction is not needed.
- Stop after 3-5 iterations or when recent runs are stable.

## Graduation

Write a self-contained skill to `skills/<task-name>/SKILL.md` when you want it committed. Include:

- purpose and trigger conditions
- exact `agent-browser` workflow
- site-specific gotchas learned from traces
- failure recovery
- expected JSON/schema output

## Safety and hygiene

- Treat `autobrowse/traces/` as sensitive; it may include page text, screenshots, or authenticated data.
- Keep workspaces outside the repo unless intentionally preserving fixtures; repo root `autobrowse/` is gitignored as a backstop.
- Use unique sessions for parallel runs; harness does this automatically.
- ACPX defaults to `--approve-all` so delegated Claude can browse and write local trace artifacts; run only in trusted workspaces.
- Use `--deny-all` only for dry prompt review; browser tests need command execution.
