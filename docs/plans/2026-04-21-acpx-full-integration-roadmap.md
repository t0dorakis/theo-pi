# acpx Full Integration Roadmap

**Status:** Draft — under review  
**Date:** 2026-04-21  
**Scope:** Evolve pi-worker from tmux-scraping prototype to a production-grade ACP-first VM orchestration system using acpx.

---

## Current state

The pi-worker runtime dispatches jobs to one of two backends:
- **tmux**: types prompts into a pane, scrapes XML markers from pane output
- **smolvm**: SSHes into a lightweight VM, runs `pi -p "..."` synchronously

Both are functional but have known gaps:
- tmux scraping is fragile (scroll limits, ANSI noise, timing races)
- neither backend supports multi-turn conversations
- no structured output — downstream tooling parses raw text
- no cancel, no parallel workstreams
- backend is hard-coded per deploy; no hot-swap

The foundation PR (`feat/acpx-backend`) adds a third backend using `acpx <agent> exec` which fixes the scraping problem. This plan describes what comes next.

---

## Phase 1 — Ship and harden exec mode (1–2 days)

**Goal:** Get `PI_WORKER_BACKEND=acpx` working reliably on a real VM and retire the XML marker trick.

### Tasks

1. **Bootstrap install**  
   Add `npm install -g acpx@latest` to `bootstrap-ubuntu-pi-worker.sh` and `install-theo-pi-worker.sh`.

2. **Health check**  
   Add `acpx --version` check to `pi-worker-verify.sh` and `pi-worker-health` (non-fatal warning if missing when backend ≠ acpx).

3. **Smoke test on live VM**  
   Run `PI_WORKER_BACKEND=acpx acpx pi exec "what is 2+2"` directly on the VM, then run a real job through `pi-worker-run-job` with the new backend.

4. **Env docs**  
   Document `PI_WORKER_BACKEND`, `ACPX_AGENT`, `ACPX_CWD`, `ACPX_COMMAND` in `pi-worker-instance` help output and the main README.

**Verification:** `PI_WORKER_BACKEND=acpx npm run test:vm` passes end-to-end.

---

## Phase 2 — Persistent sessions for Telegram threads (3–5 days)

**Goal:** Each Telegram conversation thread maps to a persistent acpx session so Pi accumulates context across messages instead of starting fresh each time.

### Problem with exec mode

`acpx exec` is stateless — Pi sees each job as a brand-new conversation. For typical Telegram usage ("fix the tests" → "now add docs for it") the model has no memory of prior work.

### Solution

Use `acpx pi sessions new --name <chatId> --cwd <repoPath>` to create a named session per chat. Subsequent jobs in the same chat route through `acpx pi -s <chatId> <prompt>`.

### Tasks

1. **`AcpxSessionBackend`** — new backend variant that:
   - On first job for a `chatId`: calls `acpx pi sessions new --name <chatId>`
   - On subsequent jobs: calls `acpx pi -s <chatId> <prompt>`
   - Detects `NO_SESSION` exit (session closed externally) and recreates
   - Stores session metadata in `~/.pi-worker/acpx-sessions/<chatId>.json`

2. **Session lifecycle**  
   - Close session on Telegram `/reset` command
   - TTL-based auto-close (configurable, default 24h of inactivity)

3. **Backend selector**  
   Add `PI_WORKER_BACKEND=acpx-session` as a separate backend id (keeps exec mode available for stateless one-shot use).

4. **Parallel named streams**  
   Support `PI_WORKER_BACKEND=acpx-session` with named sessions per chat thread — users can run `-s backend` and `-s frontend` in different chats.

**Verification:** Send two related prompts via Telegram, verify second response references first.

---

## Phase 3 — Structured output pipeline (2–3 days)

**Goal:** Use `--format json` to replace raw text parsing with typed ACP events throughout the stack.

### Tasks

1. **NDJSON result channel**  
   Store `--format json` NDJSON stream in `results/<jobId>.ndjson` alongside the plain-text result file.

2. **Event types**  
   Parse `text`, `tool_call`, `thinking` events. Surface `tool_call` titles in Telegram "typing" indicator.

3. **Suppress reads in Telegram**  
   Add `--suppress-reads` flag support so large file reads don't bloat Telegram messages.

4. **Structured result type**  
   Extend `WorkerJob` with `resultFormat: "text" | "json"` (field already exists, wire it up).

**Verification:** `--format json` output stored per job; Telegram shows tool-call titles during execution.

---

## Phase 4 — acpx Flows for multi-step VM tasks (1–2 weeks)

**Goal:** Replace ad-hoc multi-prompt Telegram sequences with structured TypeScript flow definitions.

### Use cases

- **PR triage:** fetch PR → extract intent → run tests → post review comment
- **Feature implementation:** create worktree → implement → run tests → open PR
- **Self-healing:** detect failing tests → diagnose → fix → verify → report

### Tasks

1. **Flow runner integration**  
   Add `pi-worker-flow-run <flowFile> [--input-json <json>]` script that wraps `acpx flow run` with the worker's env, state dir, and permission flags.

2. **Flow trigger from Telegram**  
   Add `/flow <name> [args]` Telegram command that maps to registered named flows.

3. **Flow registry**  
   Add `flows/` directory in the repo. Named flows listed in config, triggerable by name.

4. **VM workspace isolation**  
   Each flow gets a dedicated worktree via `action` node + `git worktree add`. `acp` nodes scoped to that directory via `cwd`.

5. **Approval checkpoint**  
   `checkpoint` nodes → send Telegram message asking "Continue? [yes/no]". Resume on reply.

6. **Replay viewer**  
   Use `examples/flows/replay-viewer` from acpx to inspect past flow runs locally.

**Example flow:**

```ts
export default defineFlow({
  name: "fix-and-pr",
  startAt: "prepare",
  nodes: {
    prepare: action({ run: () => shell("git worktree add /tmp/fix-branch -b fix/auto") }),
    diagnose: acp({ cwd: "/tmp/fix-branch", prompt: "Diagnose failing tests and propose minimal fix" }),
    implement: acp({ cwd: "/tmp/fix-branch", prompt: ({ outputs }) => `Apply fix: ${outputs.diagnose.plan}` }),
    test: action({ run: () => shell("cd /tmp/fix-branch && npm test") }),
    confirm: checkpoint({ summary: "Tests pass — open PR?" }),
    open_pr: action({ run: () => shell("gh pr create --title 'auto fix' --body '...'") }),
  },
  edges: [
    { from: "prepare", to: "diagnose" },
    { from: "diagnose", to: "implement" },
    { from: "implement", to: "test" },
    { from: "test", to: "confirm" },
    { from: "confirm", to: "open_pr" },
  ],
})
```

**Verification:** Run `fix-and-pr` flow end-to-end in a test repo via Telegram `/flow fix-and-pr`.

---

## Phase 5 — Multi-agent and multi-VM (future)

**Goal:** Route different jobs to different agents or VMs based on task type or load.

### Ideas

- **Agent routing:** classify task type (code, docs, research) → route to best agent (`pi`, `codex`, `claude`)
- **VM pool:** multiple smolvm instances, job dispatcher picks least-loaded VM
- **acpx as orchestrator backend:** run acpx on a coordinator VM that fans jobs out to worker VMs over ACP
- **Named session isolation:** one session per VM, named by VM ID — no cross-VM state leakage

---

## Risk areas

| Risk | Mitigation |
|---|---|
| acpx is alpha — API may change | Pin to a minor version; watch CHANGELOG |
| Pi ACP adapter may lag behind acpx | Test `acpx pi exec` after each Pi update |
| Persistent sessions accumulate large context | Add TTL + explicit `/reset` + session size monitoring |
| Exec mode has no cancel | Phase 2 adds persistent sessions with cooperative cancel |
| Flow checkpoint blocks indefinitely | Add timeout + auto-escalate to Telegram |

---

## Success criteria

- Phase 1: real VM jobs completing via `PI_WORKER_BACKEND=acpx` with zero XML marker errors
- Phase 2: Telegram conversation thread maintains context across 5+ consecutive messages
- Phase 3: `--format json` output captured per job; tool titles visible in Telegram
- Phase 4: At least one real flow (`fix-and-pr` or `pr-triage`) running end-to-end via Telegram
