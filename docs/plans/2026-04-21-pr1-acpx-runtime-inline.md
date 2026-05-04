# PR1: Replace exec subprocess with acpx/runtime in-process API

> Status: merged into `feat/acpx-backend`; ACPX runtime adapter is now the sole execution path.


**Branch:** `feat/pr1-acpx-runtime-inline`  
**Status:** merged
**Depends on:** none — foundation PR  
**Estimated scope:** ~250 LOC changed, ~100 LOC new

---

## Why

The current `acpx-backend.ts` creates a new OS process for every job:

```ts
options.runLocal(acpx, [agent, "exec", "--format", "quiet", "--approve-all", prompt])
```

This carries significant hidden costs:

- **Cold-start overhead.** Every job pays the full Node.js/Bun startup + acpx module load cost (~200–800 ms depending on the host).
- **Stdout piping.** The entire agent response travels through a pipe as untyped bytes, trimmed and returned as a raw string. There is no structured event stream — only final output.
- **Timeout races.** The `Promise.race` against `setTimeout` can leave a zombie subprocess running after the caller times out; there is no way to signal it.
- **No streaming.** The Telegram user receives nothing until the job completes. Long-running agents (2–10 min) give zero feedback.
- **No cancel.** `cancel()` is a no-op comment: `// exec-mode jobs are one-shot — no live session to cancel.`
- **`--approve-all` is invisible.** Permission grants are silently swallowed; there is no audit trail of what the agent was permitted to do.

`acpx/runtime` exposes the full runtime as an in-process TypeScript API. We embed it once and run every job through it with zero subprocess overhead, typed event streaming, and real cancel support.

---

## What Changes

### New file: `scripts/vm/lib/backends/acpx-runtime-backend.ts`

This file replaces `acpx-backend.ts` as the default `acpx` backend. It imports and uses `AcpxRuntime` directly.

```ts
import {
  AcpxRuntime,
  createAgentRegistry,
  createFileSessionStore,
  AcpRuntimeError,
} from "acpx/runtime"
import type { AcpRuntime, AcpRuntimeHandle } from "acpx/runtime"
import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"

export type AcpxRuntimeBackendOptions = {
  stateDir: string
  acpxStateDir: string      // separate from stateDir — acpx session store root
  agent: string
  cwd: string | undefined
  timeoutMs: number
}

export function createAcpxRuntimeBackend(options: AcpxRuntimeBackendOptions): WorkerBackend {
  const resultChannel = createResultChannel(options.stateDir)

  // One runtime instance shared across all jobs on this worker process.
  const runtime: AcpRuntime = new AcpxRuntime({
    cwd: options.cwd ?? process.cwd(),
    sessionStore: createFileSessionStore({ stateDir: options.acpxStateDir }),
    agentRegistry: createAgentRegistry(),
    permissionMode: "approve-all",
    timeoutMs: options.timeoutMs,
  })

  // In-flight turn cancellers: jobId → cancel function
  const activeTurns = new Map<string, () => Promise<void>>()

  return {
    async submitPrompt(job: WorkerJob) {
      let handle: AcpRuntimeHandle
      try {
        handle = await runtime.ensureSession({
          sessionKey: job.id,       // one-shot: session key == job id
          agent: options.agent,
          mode: "oneshot",
          cwd: options.cwd,
        })
      } catch (error) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-runtime",
          status: "failed",
          error: `session init failed: ${error instanceof Error ? error.message : String(error)}`,
          completedAt: nowIso(),
        })
        return
      }

      const turn = runtime.startTurn({
        handle,
        text: job.prompt,
        mode: "prompt",
        requestId: job.id,
        timeoutMs: options.timeoutMs,
      })

      activeTurns.set(job.id, () => turn.cancel({ reason: "worker cancel" }))

      const outputChunks: string[] = []

      try {
        for await (const event of turn.events) {
          if (event.type === "text_delta" && event.stream !== "thought") {
            outputChunks.push(event.text)
          }
          // thought and tool_call events are discarded here;
          // PR2 will intercept them for Telegram streaming before they reach this loop
        }

        const result = await turn.result

        if (result.status === "completed") {
          await resultChannel.writeResult({
            id: job.id,
            backendId: "acpx-runtime",
            status: "done",
            answer: outputChunks.join("").trim(),
            completedAt: nowIso(),
          })
        } else if (result.status === "cancelled") {
          await resultChannel.writeResult({
            id: job.id,
            backendId: "acpx-runtime",
            status: "failed",
            error: `turn cancelled: ${result.stopReason ?? "no reason"}`,
            completedAt: nowIso(),
          })
        } else {
          await resultChannel.writeResult({
            id: job.id,
            backendId: "acpx-runtime",
            status: "failed",
            error: `turn failed: ${result.error.message} (${result.error.code ?? "unknown"})`,
            completedAt: nowIso(),
          })
        }
      } catch (error) {
        const msg = error instanceof AcpRuntimeError
          ? `AcpRuntimeError(${error.code}): ${error.message}`
          : `${error instanceof Error ? error.message : String(error)}`
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-runtime",
          status: "failed",
          error: msg,
          completedAt: nowIso(),
        })
      } finally {
        activeTurns.delete(job.id)
      }
    },

    async readResult(job: WorkerJob) {
      const result = await resultChannel.readResult(job.id).catch(() => null)
      if (!result) return null
      if (result.status === "failed") throw new Error(result.error ?? "acpx job failed")
      return result.answer ?? null
    },

    async sessionHealth() {
      try {
        if (!("doctor" in runtime) || typeof runtime.doctor !== "function") {
          return { ok: true, detail: "doctor not available" }
        }
        const report = await runtime.doctor()
        return { ok: report.ok, detail: report.message }
      } catch (error) {
        return {
          ok: false,
          detail: `runtime doctor failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    async cancel(jobId: string) {
      const cancelFn = activeTurns.get(jobId)
      if (cancelFn) {
        await cancelFn()
        activeTurns.delete(jobId)
      }
    },
  }
}
```

Key design decisions:
- `sessionKey = job.id` for one-shot mode — unique per job, no cross-job session leakage.
- `activeTurns` map enables real cancel: `turn.cancel()` sends ACP `session/cancel` to the agent process and resolves. No zombie processes.
- `turn.result` is awaited separately after the event loop — `startTurn().events` does not include terminal events, matching the contract in `contract.ts`.
- `AcpRuntimeError` is caught specifically so error codes (`ACP_SESSION_INIT_FAILED`, `ACP_TURN_TIMEOUT`, etc.) appear in the result error string.

---

### Changes to `scripts/vm/lib/env.ts`

Add two new fields to `AcpxConfig` and populate them from env vars:

```ts
export type AcpxConfig = {
  command: string          // kept for legacy exec-mode fallback
  agent: string
  cwd: string | undefined
  stateDir: string         // NEW: acpx session store root, default ~/.pi-worker/acp
  timeoutMs: number        // NEW: per-turn timeout ms, default 10 min
}
```

In `getWorkerEnv()`:

```ts
acpx: {
  command: process.env.ACPX_COMMAND ?? "acpx",
  agent: process.env.ACPX_AGENT ?? "pi",
  cwd: process.env.ACPX_CWD || undefined,
  stateDir: process.env.ACPX_STATE_DIR ?? `${homeDir}/.pi-worker/acp`,
  timeoutMs: intFromEnv("ACPX_TIMEOUT_MS", 10 * 60 * 1000),
},
```

`ACPX_STATE_DIR` is kept separate from `PI_WORKER_STATE_DIR` intentionally — acpx manages its own session store layout (rotating NDJSON segments, session records) that should not be co-mingled with worker job records.

---

### Changes to `scripts/vm/lib/backend-registry.ts`

Add a new case `"acpx-runtime"` to `WorkerBackendId` and wire the new backend:

```ts
// backend.ts
export type WorkerBackendId = "tmux" | "smolvm" | "acpx" | "acpx-runtime"

// backend-registry.ts
import { createAcpxRuntimeBackend } from "./backends/acpx-runtime-backend"

case "acpx-runtime":
  return createAcpxRuntimeBackend({
    stateDir: options.env.stateDir,
    acpxStateDir: options.env.acpx.stateDir,
    agent: options.env.acpx.agent,
    cwd: options.env.acpx.cwd,
    timeoutMs: options.env.acpx.timeoutMs,
  })
```

The old `"acpx"` case (subprocess exec) is preserved so existing deployments can continue using it during a rolling migration. Set `PI_WORKER_BACKEND=acpx-runtime` to opt in.

---

### Changes to `package.json` / `package-lock.json`

```bash
cd /home/minimi/workspaces/theo-pi
npm install acpx
```

Verify the import path is correct after install:

```ts
import { AcpxRuntime, createFileSessionStore } from "acpx/runtime"
// should resolve to node_modules/acpx/dist/runtime.js or similar
```

If acpx uses a non-standard `exports` map, check `node_modules/acpx/package.json` exports field and adjust the import path or add a `paths` alias in `tsconfig.json`.

---

## Task Checklist

- [ ] `npm install acpx` and verify `acpx/runtime` import resolves
- [ ] Add `stateDir` and `timeoutMs` to `AcpxConfig` in `env.ts`
- [ ] Add `ACPX_STATE_DIR` and `ACPX_TIMEOUT_MS` reading in `getWorkerEnv()`
- [ ] Create `scripts/vm/lib/backends/acpx-runtime-backend.ts`
- [ ] Add `"acpx-runtime"` to `WorkerBackendId` union in `backend.ts`
- [ ] Wire `"acpx-runtime"` case in `backend-registry.ts`
- [ ] Write unit tests (see below)
- [ ] Manual smoke test: `PI_WORKER_BACKEND=acpx-runtime bun scripts/vm/pi-worker-run-job.ts <jobId>`
- [ ] Update `.env.example` with `ACPX_STATE_DIR`, `ACPX_TIMEOUT_MS`

---

## Test Strategy

File: `scripts/vm/lib/backends/acpx-runtime-backend.test.ts`

**Test 1 — successful turn:**
```ts
const mockRuntime = {
  ensureSession: vi.fn().mockResolvedValue({ sessionKey: "job-1", backend: "acpx", ... }),
  startTurn: vi.fn().mockReturnValue({
    events: (async function*() {
      yield { type: "text_delta", text: "Hello", stream: "output" }
      yield { type: "text_delta", text: " world", stream: "output" }
      yield { type: "text_delta", text: "thinking...", stream: "thought" } // should be excluded
    })(),
    result: Promise.resolve({ status: "completed" }),
    cancel: vi.fn(),
  }),
  doctor: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
}
// Assert: resultChannel.readResult returns "Hello world" (thought excluded)
```

**Test 2 — turn failure:**  
`startTurn().result` resolves `{ status: "failed", error: { message: "timeout", code: "ACP_TURN_TIMEOUT" } }` → result written with `status: "failed"`, error contains code.

**Test 3 — cancel in-flight:**  
Call `backend.cancel(jobId)` while `submitPrompt` is awaiting events → `turn.cancel()` is called exactly once, `activeTurns` map is cleared.

**Test 4 — session init failure:**  
`ensureSession` throws `AcpRuntimeError("ACP_SESSION_INIT_FAILED", "...")` → result written immediately with `status: "failed"` containing the error code, `startTurn` never called.

**Test 5 — `sessionHealth` doctor:**  
`runtime.doctor()` returns `{ ok: false, message: "pi not found" }` → `sessionHealth()` returns `{ ok: false, detail: "pi not found" }`.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `acpx/runtime` import path changes in a future release | Medium | Pin exact acpx version in package.json; add import smoke test to CI |
| `createFileSessionStore` session records conflict with parallel workers using same `acpxStateDir` | Low | One-shot mode uses `sessionKey = jobId` so keys are globally unique |
| `AcpxRuntime` constructor options evolve (e.g. new required field) | Medium | Wrap construction in `createAcpxRuntimeBackend` factory; keep old exec backend as fallback |
| First `startTurn` call on a newly created runtime is slower than subsequent calls (lazy manager init) | Low — acceptable | `probeAvailability()` could be called at startup to warm the manager |
| `acpx/runtime` is marked alpha | Known | Keep old `"acpx"` subprocess backend available via `PI_WORKER_BACKEND=acpx` for rollback |

---

## Definition of Done

- `PI_WORKER_BACKEND=acpx-runtime bun scripts/vm/pi-worker-run-job.ts <real-job-id>` completes with a non-empty answer written to the result channel.
- All 5 unit tests pass.
- `sessionHealth()` returns `ok: true` when Pi is available.
- `cancel()` is not a no-op: calling it mid-turn causes the job to complete with `status: "failed"` and an error containing "cancelled".
- Old `"acpx"` subprocess backend still works unmodified.
