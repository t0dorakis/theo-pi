# SmolVM Telegram Spike Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a separate Telegram bot spike that reuses current Theo Pi bot flow while executing prompts through a SmolVM guest-local Pi runtime.

**Architecture:** Keep `scripts/vm/pi-worker-telegram-bot.ts` and `scripts/vm/pi-worker-run-job.ts` as transport/runtime entrypoints, but make backend choice configurable. Add a SmolVM backend adapter beside tmux backend, plus a small SmolVM helper module for VM lifecycle, guest preflight, bootstrap, and guest command execution. Use a dedicated spike entrypoint/config so current bot remains untouched.

**Tech Stack:** Bun, TypeScript, existing Theo Pi runtime modules, SmolVM CLI or Python facade through host shell commands, Telegram Bot HTTP API, local QEMU-backed SmolVM guest.

---

### Task 1: Freeze current runtime seams for SmolVM planning

**Files:**
- Read: `scripts/vm/lib/backend.ts`
- Read: `scripts/vm/pi-worker-run-job.ts`
- Read: `scripts/vm/pi-worker-telegram-bot.ts`
- Read: `scripts/vm/lib/env.ts`
- Read: `scripts/vm/lib/types.ts`
- Read: `docs/plans/2026-04-20-smolvm-telegram-spike-design.md`

**Step 1: Confirm current backend contract is enough or note minimum delta**

Check whether SmolVM backend can satisfy:
- `submitPrompt(job)`
- `readResult(job)`
- `sessionHealth()`
- optional `cancel(jobId)`

Write down concrete gaps before touching code.

**Step 2: Confirm where backend is currently hardcoded**

Inspect:
- `scripts/vm/pi-worker-run-job.ts`
- `scripts/vm/pi-worker-gateway.ts`
- any env parsing that assumes tmux/session only

Expected result: exact list of files needing backend selection.

**Step 3: No code change yet — record assumptions in plan notes**

Assumptions should include:
- spike targets Telegram polling bot only
- one warm SmolVM guest per bot process
- guest-local workdir only
- Pi commands must close stdin

**Step 4: Commit nothing**

This task is context lock-in only.

### Task 2: Add failing tests for backend selection and SmolVM backend contract

**Files:**
- Create: `scripts/vm/lib/backends/smolvm-backend.test.ts`
- Modify: `scripts/vm/lib/backends/tmux-backend.test.ts`
- Modify: `scripts/vm/lib/backend.ts`
- Test: `scripts/vm/lib/backends/smolvm-backend.test.ts`

**Step 1: Write failing tests for new backend behavior**

Add tests covering at least:
- backend factory or selection chooses `smolvm` when job/backend env requests it
- SmolVM backend submit path stages request and launches guest command
- SmolVM backend health reports unhealthy when guest preflight fails
- Pi command builder always closes stdin for guest execution
- result extraction returns final stdout answer or clean failure

Example test cases to add:

```ts
test("smolvm backend runs guest pi with stdin closed", async () => {
  const calls: string[] = []
  const backend = createSmolVmBackend({
    stateDir: "/tmp/state",
    session: "smol-spike",
    runHost: async (command, args) => {
      calls.push([command, ...args].join(" "))
      return ""
    },
    now: () => "2026-04-20T10:00:00.000Z",
  })

  await backend.submitPrompt({ id: "job-1", prompt: "hello", status: "running", createdAt: "2026-04-20T10:00:00.000Z" } as any)

  expect(calls.join("\n")).toContain("</dev/null")
})
```

```ts
test("smolvm backend health returns detail when guest preflight fails", async () => {
  const backend = createSmolVmBackend({
    stateDir: "/tmp/state",
    session: "smol-spike",
    runHost: async () => {
      throw new Error("missing pi")
    },
  })

  await expect(backend.sessionHealth()).resolves.toEqual({
    ok: false,
    detail: expect.stringContaining("missing pi"),
  })
})
```

**Step 2: Run tests to verify they fail**

Run:
```bash
bun test scripts/vm/lib/backends/tmux-backend.test.ts scripts/vm/lib/backends/smolvm-backend.test.ts
```

Expected: FAIL because SmolVM backend/factory does not exist yet.

**Step 3: Commit nothing yet**

### Task 3: Introduce backend registry and runtime selection

**Files:**
- Create: `scripts/vm/lib/backend-registry.ts`
- Modify: `scripts/vm/lib/backend.ts`
- Modify: `scripts/vm/lib/env.ts`
- Modify: `scripts/vm/pi-worker-run-job.ts`
- Modify: `scripts/vm/pi-worker-gateway.ts`
- Test: `scripts/vm/lib/backends/smolvm-backend.test.ts`

**Step 1: Add minimal backend registry API**

Implement explicit backend selection so runtime code does not instantiate tmux backend directly.

Suggested shape:

```ts
export type WorkerBackendId = "tmux" | "smolvm"

export interface WorkerBackendContext {
  session: string
  stateDir: string
  captureLines: number
  runLocal(command: string, args?: string[]): Promise<string>
}

export function createBackend(id: WorkerBackendId, context: WorkerBackendContext): WorkerBackend {
  // switch on id
}
```

**Step 2: Extend env parsing for backend choice**

In `scripts/vm/lib/env.ts`, add env such as:
- `PI_WORKER_BACKEND` default `tmux`
- optional SmolVM-specific knobs later

Validate allowed values strictly.

**Step 3: Refactor runtime entrypoints to use registry**

Update:
- `scripts/vm/pi-worker-run-job.ts`
- `scripts/vm/pi-worker-gateway.ts`

Replace direct `createTmuxBackend(...)` calls with registry-based selection.

**Step 4: Run targeted tests**

Run:
```bash
bun test scripts/vm/lib/backends/tmux-backend.test.ts scripts/vm/lib/backends/smolvm-backend.test.ts
node --check scripts/vm/pi-worker-run-job.ts scripts/vm/pi-worker-gateway.ts scripts/vm/lib/env.ts scripts/vm/lib/backend-registry.ts
```

Expected: tmux still passes; SmolVM tests still fail until backend exists.

**Step 5: Commit**

```bash
git add scripts/vm/lib/backend.ts scripts/vm/lib/backend-registry.ts scripts/vm/lib/env.ts scripts/vm/pi-worker-run-job.ts scripts/vm/pi-worker-gateway.ts
 git commit -m "refactor: make worker backend selectable"
```

### Task 4: Add SmolVM host helper module with fakeable command surface

**Files:**
- Create: `scripts/vm/lib/smolvm.ts`
- Create: `scripts/vm/lib/smolvm.test.ts`
- Modify: `scripts/vm/lib/env.ts`
- Test: `scripts/vm/lib/smolvm.test.ts`

**Step 1: Write failing helper tests first**

Cover helper behavior for:
- building VM name from session/config
- create-or-reuse workflow
- explicit delete on failed cleanup path
- guest ssh command builder
- guest Pi command builder with stdin closed
- guest preflight command list (`node`, `npm`, `pi`, settings, auth)

Example helper test:

```ts
test("buildGuestPiCommand closes stdin", () => {
  const command = buildGuestPiCommand({ prompt: "say hi", workdir: "~/work" })
  expect(command).toContain("</dev/null")
  expect(command).toContain("pi ")
})
```

**Step 2: Implement helper with narrow interface**

Suggested exported functions:
- `createSmolVmManager(options)`
- `ensureVm()`
- `runGuest(command)`
- `stageGuestFile(path, content)` or `runGuestScript(script)`
- `deleteVm()`
- `preflightGuest()`

Keep implementation fakeable by injecting host command runner.

**Step 3: Add env/config fields needed by helper**

In `scripts/vm/lib/env.ts`, parse fields such as:
- `SMOLVM_ENABLED`
- `SMOLVM_VM_NAME`
- `SMOLVM_BACKEND` default `qemu`
- `SMOLVM_DISK_SIZE_MIB`
- `SMOLVM_MEMORY_MIB`
- `SMOLVM_GUEST_WORKDIR`
- `SMOLVM_GUEST_PI_SETTINGS_PATH`
- `SMOLVM_GUEST_PI_AUTH_PATH`

Do not over-design. Only add fields needed by spike.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/smolvm.test.ts
node --check scripts/vm/lib/smolvm.ts scripts/vm/lib/env.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/lib/smolvm.ts scripts/vm/lib/smolvm.test.ts scripts/vm/lib/env.ts
 git commit -m "feat: add smolvm host helper"
```

### Task 5: Implement SmolVM backend adapter

**Files:**
- Create: `scripts/vm/lib/backends/smolvm-backend.ts`
- Modify: `scripts/vm/lib/backends/smolvm-backend.test.ts`
- Modify: `scripts/vm/lib/backend-registry.ts`
- Modify: `scripts/vm/lib/result-channel.ts` (only if needed)
- Test: `scripts/vm/lib/backends/smolvm-backend.test.ts`

**Step 1: Implement minimal SmolVM backend contract**

`submitPrompt(job)` should:
- ensure guest exists and passes preflight
- create per-job guest directory
- write prompt to guest or inline into command safely
- execute guest Pi command through SmolVM helper
- persist enough local state for later result read

`readResult(job)` should:
- return final answer if available
- otherwise `null`
- translate guest failure into controlled error when possible

`sessionHealth()` should:
- call helper preflight
- return `{ ok: true }` only when guest ready

**Step 2: Prefer local result file contract over pane scraping**

Unlike tmux backend, SmolVM backend should not parse tmux panes. It should capture guest command result directly and map it into existing result semantics.

If needed, write per-job host-side metadata under existing state dir so `readResult(job)` can poll deterministic files.

**Step 3: Update registry to return SmolVM backend**

Use strict switch and fail loudly on unknown backend.

**Step 4: Run tests**

Run:
```bash
bun test scripts/vm/lib/backends/smolvm-backend.test.ts scripts/vm/lib/smolvm.test.ts scripts/vm/lib/backends/tmux-backend.test.ts
node --check scripts/vm/lib/backends/smolvm-backend.ts scripts/vm/lib/backend-registry.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/lib/backends/smolvm-backend.ts scripts/vm/lib/backends/smolvm-backend.test.ts scripts/vm/lib/backend-registry.ts scripts/vm/lib/result-channel.ts
 git commit -m "feat: add smolvm worker backend"
```

### Task 6: Add dedicated SmolVM Telegram spike entrypoint and config isolation

**Files:**
- Create: `scripts/vm/pi-worker-telegram-bot-smolvm.ts`
- Create: `scripts/vm/pi-worker-telegram-bot-smolvm`
- Modify: `scripts/vm/pi-worker-telegram-bot.ts` (only if shared extraction is worth it)
- Modify: `scripts/vm/bootstrap-ubuntu-pi-worker.sh` (only if wrapper install matters locally)
- Modify: `README.md`
- Test: manual smoke run

**Step 1: Create isolated spike entrypoint**

Preferred implementation:
- wrapper script sets `PI_WORKER_BACKEND=smolvm`
- points to separate state dir if needed
- then invokes existing `pi-worker-telegram-bot.ts`

Example wrapper shape:

```bash
#!/usr/bin/env bash
set -euo pipefail
export PI_WORKER_BACKEND=smolvm
export PI_WORKER_STATE_DIR="${PI_WORKER_STATE_DIR:-$HOME/.pi-worker-smolvm}"
exec bun "$(dirname "$0")/pi-worker-telegram-bot.ts" "$@"
```

**Step 2: Keep current bot isolated**

Ensure new bot uses:
- separate Telegram bot token env source or separate env file
- separate state dir if job/result channels would otherwise collide
- same allowed chat checks

**Step 3: Update docs with exact env variables**

Document required spike env:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `PI_WORKER_BACKEND=smolvm`
- `PI_WORKER_STATE_DIR`
- SmolVM-specific env knobs

**Step 4: Run syntax check**

Run:
```bash
node --check scripts/vm/pi-worker-telegram-bot.ts scripts/vm/pi-worker-telegram-bot-smolvm.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/vm/pi-worker-telegram-bot-smolvm.ts scripts/vm/pi-worker-telegram-bot-smolvm scripts/vm/pi-worker-telegram-bot.ts README.md scripts/vm/bootstrap-ubuntu-pi-worker.sh
 git commit -m "feat: add smolvm telegram spike entrypoint"
```

### Task 7: Add deterministic smoke tests with fake SmolVM runner

**Files:**
- Create: `scripts/vm/smolvm-telegram-smoke-test`
- Create: `scripts/vm/lib/backends/smolvm-backend.integration.test.ts` or extend existing tests
- Possibly create: `scripts/vm/test-bin/fake-smolvm`
- Test: smoke script

**Step 1: Write fake SmolVM executable or fake host runner**

It must simulate:
- guest create/reuse
- guest preflight success
- guest Pi command returning answer
- forced timeout or failure path

**Step 2: Add smoke test for end-to-end local bot/job path without real Telegram**

At minimum verify:
- enqueue job
- `pi-worker-run-job` with `PI_WORKER_BACKEND=smolvm` processes it
- result file/job status becomes `done`
- failure path marks job `failed`

**Step 3: Run smoke test**

Run:
```bash
bun test scripts/vm/lib/backends/smolvm-backend.integration.test.ts
bash scripts/vm/smolvm-telegram-smoke-test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/vm/smolvm-telegram-smoke-test scripts/vm/lib/backends/smolvm-backend.integration.test.ts scripts/vm/test-bin/fake-smolvm
 git commit -m "test: add smolvm telegram spike smoke coverage"
```

### Task 8: Run real SmolVM guest preflight manually

**Files:**
- No code change required unless drift discovered
- Reference: `docs/plans/2026-04-19-smolvm-architecture-analysis.md`

**Step 1: Verify host prerequisites**

Run:
```bash
smolvm doctor --backend qemu
```

Expected: usable QEMU setup.

**Step 2: Verify guest Pi works before Telegram**

Run real guest checks through helper or manual commands:
```bash
pi --help
pi -p "reply with pong" </dev/null
```

Expected: authenticated guest one-shot works.

**Step 3: If guest bootstrap fails, patch helper/config and rerun targeted tests**

Run any affected local tests before moving on.

**Step 4: Commit only if code changed**

```bash
git add scripts/vm/lib/smolvm.ts scripts/vm/lib/backends/smolvm-backend.ts scripts/vm/lib/env.ts README.md
 git commit -m "fix: harden smolvm guest bootstrap"
```

### Task 9: Run live Telegram spike with new bot token

**Files:**
- Modify docs only if needed: `README.md`, `docs/plans/2026-04-16-telegram-polling-bot-notes.md`

**Step 1: Start isolated bot**

Run with separate env file or exported vars:
```bash
export TELEGRAM_BOT_TOKEN="<new-bot-token>"
export TELEGRAM_ALLOWED_CHAT_IDS="<your-chat-id>"
export PI_WORKER_BACKEND="smolvm"
export PI_WORKER_STATE_DIR="$HOME/.pi-worker-smolvm"
export SMOLVM_BACKEND="qemu"
bun scripts/vm/pi-worker-telegram-bot.ts
```

Or use wrapper if created:
```bash
scripts/vm/pi-worker-telegram-bot-smolvm
```

**Step 2: Send one plain text message from Telegram**

Expected:
- bot shows typing
- guest Pi executes in SmolVM
- final answer comes back

**Step 3: Trigger one controlled failure**

Examples:
- break auth path
- set tiny timeout
- force guest command failure

Expected: Telegram receives clean error message, not silent hang.

**Step 4: Test repeated job on warm guest**

Send second prompt.
Expected: no cold-create regression unless intentional recycle occurred.

**Step 5: Capture exact evidence**

Save command output and final observations in progress/doc updates.

### Task 10: Update docs and progress after verification

**Files:**
- Modify: `.agent/progress.md`
- Modify: `.agent/tasks.json` via task tool
- Modify: `README.md`
- Modify: `docs/plans/2026-04-16-telegram-polling-bot-notes.md`
- Modify: `docs/plans/2026-04-19-smolvm-architecture-analysis.md` (only if spike changes recommendation)

**Step 1: Document exact spike run command and env contract**

README/docs should include:
- isolated bot command
- required env vars
- stdin-closure pitfall
- guest-local workspace limitation
- cleanup recommendation

**Step 2: Update progress/task state**

Record:
- what code changed
- what passed
- what failed or remains risky
- next best step after spike

**Step 3: Run final targeted validation**

Run:
```bash
npm run check
bun test scripts/vm/lib/*.test.ts scripts/vm/lib/backends/*.test.ts
```

If full suite too broad, record exact gap.

**Step 4: Commit**

```bash
git add README.md docs/plans/2026-04-16-telegram-polling-bot-notes.md docs/plans/2026-04-19-smolvm-architecture-analysis.md .agent/progress.md
 git commit -m "docs: record smolvm telegram spike results"
```

## Notes for executor

- Do not add host workspace mount support in this spike.
- Do not redesign Telegram UX.
- Do not move bot process into guest.
- Keep current tmux backend working throughout.
- Prefer deterministic host-side state files over guest pane scraping.
- When running guest Pi non-interactively, always close stdin.
- On bad VM lifecycle state, prefer explicit delete/recreate over clever recovery.
