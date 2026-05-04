---
title: acpx Integration Plan
date: 2026-04-21
status: superseded by feat/acpx-backend
---

# acpx Integration

> Status: superseded by the ACPX-only runtime adapter documented in `docs/architecture.md` and `docs/CONTEXT.md`. Paths and backend-registry references below are historical.

## What

[acpx](https://github.com/openclaw/acpx) is a headless CLI client for the
[Agent Client Protocol (ACP)](https://agentclientprotocol.com).  It lets one
agent talk to another — Pi, Codex, Claude, Gemini, Cursor, etc. — over a
structured protocol instead of PTY scraping.

## Why

The current `tmux` backend submits prompts by:

1. Formatting a prompt with an XML marker (`<final_answer id="...">`)
2. Typing it into a tmux pane via `pi-worker-delegate`
3. Polling `tmux capture-pane` output until the marker appears
4. Parsing the raw pane text to extract the answer

This works but is brittle: ANSI escape codes, pane scroll limits, timing
races, and the XML wrapper all add fragility.

acpx replaces this entire mechanism with ACP:

- Structured protocol output — no ANSI noise, no pane capture, no polling
- Any registered ACP agent (`pi`, `codex`, `claude`, …) switchable via env var
- Persistent sessions, named sessions, queuing, graceful cancel — available
  for future multi-turn work
- Machine-readable output (`--format json`) for richer downstream processing

## What landed (foundation PR)

- `scripts/vm/lib/backend.ts` — added `WorkerBackendId = "tmux" | "smolvm" | "acpx"`
- `scripts/vm/lib/env.ts` — added `backend`, `acpxCommand`, `acpxAgent`, `acpxCwd` fields; also surfaced the smolvm env fields that were already used in backend-registry
- `scripts/vm/lib/backends/acpx-backend.ts` — new `WorkerBackend` impl using `acpx <agent> exec --format quiet --approve-all`
- `scripts/vm/lib/backends/acpx-backend.test.ts` — 7 unit tests
- `scripts/vm/lib/backend-registry.ts` — wired `acpx` case

## How to enable

```bash
# Install acpx globally on the VM
npm install -g acpx@latest

# Set backend to acpx (and optionally configure agent + working dir)
export PI_WORKER_BACKEND=acpx
export ACPX_AGENT=pi            # or: codex, claude, gemini, …
export ACPX_CWD=/repo/myapp    # optional: scope session to a directory
export ACPX_COMMAND=acpx       # optional: override binary path

# Run as normal — gateway and Telegram bot are unaffected
./scripts/vm/pi-worker-gateway
```

If `acpx` is not installed or `PI_WORKER_BACKEND` is unset, the runtime falls
back to the existing `tmux` backend (default unchanged).

## Exec mode vs persistent sessions

The foundation uses `acpx exec` (one-shot, no saved session state).  This
matches the current job model where each job is independent.

Future work can switch to persistent sessions for multi-turn conversations:

```bash
# Persistent session scoped to a job workstream
acpx pi sessions new --name <jobId> --cwd <repoPath>
acpx pi -s <jobId> <prompt>
```

That would let the agent accumulate context across a series of related jobs —
e.g. the full sequence of a Telegram conversation thread.

## Flows

acpx also ships a `flow run` command for TypeScript workflow graphs that mix
ACP reasoning steps (`acp`) with deterministic runtime steps (`action`).

This maps directly onto our VM orchestration model:

- `action` nodes → `smolvm`/VM setup, git operations, test runs
- `acp` nodes → agent reasoning scoped to a specific VM/worktree via `cwd`
- `checkpoint` nodes → pause for Telegram approval before continuing

Example shape for a VM-delegated coding task flow:

```ts
import { defineFlow, acp, action } from "acpx/flows"

export default defineFlow({
  name: "vm-task",
  startAt: "prepare",
  nodes: {
    prepare: action({ run: () => shell("git worktree add /tmp/task-branch") }),
    implement: acp({
      cwd: "/tmp/task-branch",
      prompt: ({ input }) => `Implement: ${input.task}`,
      parse: (text) => ({ result: text }),
    }),
    validate: action({ run: () => shell("cd /tmp/task-branch && npm test") }),
  },
  edges: [
    { from: "prepare", to: "implement" },
    { from: "implement", to: "validate" },
  ],
})
```

This is a future milestone; the foundation PR only adds the `acpx` backend.

## Next steps

1. Install acpx on VMs via `bootstrap-ubuntu-pi-worker.sh`
2. Smoke-test `PI_WORKER_BACKEND=acpx` with a real Pi ACP session
3. Add `acpx` to `pi-worker-verify.sh` health checks
4. Explore persistent sessions for Telegram conversation threads
5. Prototype a simple flow for multi-step VM tasks
