# PR4: Persistent ACP sessions per Telegram chat — multi-turn context

> Status: merged into `feat/acpx-backend`; persistent sessions are keyed by `${agent}-${chatId}`.


**Branch:** `feat/pr4-acpx-persistent-sessions`  
**Status:** merged
**Depends on:** PR1 (`feat/pr1-acpx-runtime-inline`)  
**Estimated scope:** ~350 LOC new, ~100 LOC changed

---

## Problem

Every Telegram message today starts a completely fresh agent context. The sequence:

```
User: "Add error handling to the auth module"
Pi:   [does it] "Done, added try/catch blocks."
User: "Now add tests for that"
Pi:   [fresh session — has no idea what was just done] "What module? What tests?"
```

Each job calls `runtime.ensureSession({ mode: "oneshot", sessionKey: jobId })`, which creates a new ephemeral session discarded after the turn. The agent has no memory of previous turns.

The fix is `mode: "persistent"` with a `sessionKey` scoped to the Telegram chat. Persistent sessions keep the ACP session alive between turns — the agent accumulates context exactly like a normal conversation.

---

## Session Key Design

The session key must encode both the agent identity and the chat identity to prevent context bleed between different agents or different users:

```
<agent>-<chatId>
```

Examples:
- `pi-123456789`
- `claude-987654321`

This resolves the namespace collision risk noted in the roadmap review (using `chatId` alone means two agents serving the same chat would share a session). The `agent` prefix makes sessions agent-specific.

Session keys are stored in `createFileSessionStore({ stateDir: ACPX_SESSION_STORE_DIR })`. The store maps key → `AcpSessionRecord`, which contains the underlying ACP session ID that the agent process can reconnect to.

---

## New File: `scripts/vm/lib/backends/acpx-persistent-backend.ts`

This is a separate backend class from `AcpxRuntimeBackend` (PR1). It does not replace one-shot mode — both coexist. Telegram conversations use persistent; one-shot API calls use the PR1 backend.

```ts
import {
  AcpxRuntime,
  createAgentRegistry,
  createFileSessionStore,
  AcpRuntimeError,
  type AcpRuntimeErrorCode,
} from "acpx/runtime"
import type { AcpRuntime, AcpRuntimeHandle } from "acpx/runtime"
import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"
import { acquireSessionLock, releaseSessionLock } from "../session-lock"

export type AcpxPersistentBackendOptions = {
  stateDir: string
  acpxStateDir: string
  agent: string
  cwd: string | undefined
  timeoutMs: number
  sessionTtlHours: number
}

// Session handle cache: sessionKey → AcpRuntimeHandle
// In-process only — handles do not survive process restarts.
// On restart, ensureSession re-establishes from the persisted store.
const handleCache = new Map<string, AcpRuntimeHandle>()

export function createAcpxPersistentBackend(options: AcpxPersistentBackendOptions): WorkerBackend {
  const resultChannel = createResultChannel(options.stateDir)

  const runtime: AcpRuntime = new AcpxRuntime({
    cwd: options.cwd ?? process.cwd(),
    sessionStore: createFileSessionStore({ stateDir: options.acpxStateDir }),
    agentRegistry: createAgentRegistry(),
    permissionMode: "approve-all",
    timeoutMs: options.timeoutMs,
  })

  const activeTurns = new Map<string, () => Promise<void>>()

  async function getOrCreateHandle(chatId: string): Promise<AcpRuntimeHandle> {
    const sessionKey = `${options.agent}-${chatId}`

    // Fast path: handle already in memory
    const cached = handleCache.get(sessionKey)
    if (cached) return cached

    // Slow path: acquire per-key lock to prevent concurrent first-message race
    const lock = await acquireSessionLock(options.stateDir, sessionKey)
    try {
      // Re-check after acquiring lock — another coroutine may have created it
      const recheck = handleCache.get(sessionKey)
      if (recheck) return recheck

      const handle = await runtime.ensureSession({
        sessionKey,
        agent: options.agent,
        mode: "persistent",
        cwd: options.cwd,
      })
      handleCache.set(sessionKey, handle)
      return handle
    } finally {
      await releaseSessionLock(lock)
    }
  }

  async function runTurnWithRetry(job: WorkerJob, handle: AcpRuntimeHandle, retrying = false): Promise<void> {
    const sessionKey = `${options.agent}-${job.chatId}`
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
      }

      const result = await turn.result

      if (result.status === "completed") {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-persistent",
          status: "done",
          answer: outputChunks.join("").trim(),
          completedAt: nowIso(),
        })
      } else if (result.status === "cancelled") {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-persistent",
          status: "failed",
          error: `turn cancelled: ${result.stopReason ?? "no reason"}`,
          completedAt: nowIso(),
        })
      } else {
        // Check if the error is session-related and we haven't retried yet
        const code = result.error.code as AcpRuntimeErrorCode | undefined
        const sessionErrors: string[] = [
          "ACP_SESSION_INIT_FAILED",
          "ACP_SESSION_NOT_FOUND",
          "ACP_BACKEND_UNAVAILABLE",
        ]
        if (!retrying && code && sessionErrors.includes(code)) {
          // Re-create session and retry once
          handleCache.delete(sessionKey)
          const freshHandle = await getOrCreateHandle(job.chatId)
          return runTurnWithRetry(job, freshHandle, true)
        }
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-persistent",
          status: "failed",
          error: `turn failed: ${result.error.message} (${result.error.code ?? "unknown"})`,
          completedAt: nowIso(),
        })
      }
    } finally {
      activeTurns.delete(job.id)
    }
  }

  return {
    async submitPrompt(job: WorkerJob) {
      let handle: AcpRuntimeHandle
      try {
        handle = await getOrCreateHandle(job.chatId)
      } catch (error) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx-persistent",
          status: "failed",
          error: `session init failed: ${error instanceof Error ? error.message : String(error)}`,
          completedAt: nowIso(),
        })
        return
      }
      await runTurnWithRetry(job, handle)
    },

    async readResult(job: WorkerJob) {
      const result = await resultChannel.readResult(job.id).catch(() => null)
      if (!result) return null
      if (result.status === "failed") throw new Error(result.error ?? "acpx job failed")
      return result.answer ?? null
    },

    async sessionHealth() {
      try {
        if (typeof (runtime as AcpxRuntime).doctor === "function") {
          const report = await (runtime as AcpxRuntime).doctor()
          return { ok: report.ok, detail: report.message }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: `runtime health failed: ${error instanceof Error ? error.message : String(error)}` }
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

---

## New File: `scripts/vm/lib/session-lock.ts`

Per-key file lock to prevent race conditions when two concurrent first messages arrive for the same chatId before any handle exists. Uses a simple lock-file approach with exponential backoff:

```ts
export type SessionLock = {
  key: string
  lockPath: string
}

const LOCK_TIMEOUT_MS = 10_000
const LOCK_POLL_MS = 50

export async function acquireSessionLock(stateDir: string, sessionKey: string): Promise<SessionLock> {
  const lockPath = join(stateDir, "session-locks", `${sessionKey}.lock`)
  await mkdir(dirname(lockPath), { recursive: true })

  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      // O_EXCL ensures atomic creation — only one process succeeds
      const fd = await open(lockPath, "wx")
      await fd.writeFile(String(process.pid))
      await fd.close()
      return { key: sessionKey, lockPath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      await sleep(LOCK_POLL_MS)
    }
  }
  throw new Error(`session lock timeout for key: ${sessionKey}`)
}

export async function releaseSessionLock(lock: SessionLock): Promise<void> {
  await unlink(lock.lockPath).catch(() => {})
}
```

This works correctly for multiple Bun coroutines within one process (event loop serialization) and for multiple OS processes (O_EXCL exclusion). It does not handle cross-host scenarios (multi-machine deployments would need a distributed lock), but that is out of scope.

---

## Session Reset: `/reset` Command

When the user sends `/reset` in Telegram, the persistent session for that chat is discarded and recreated fresh.

Changes to `scripts/vm/lib/telegram-poller.ts`:

```ts
if (textValue === "/reset") {
  const sessionKey = `${env.acpx.agent}-${chatId}`
  // Close the persistent session and discard state
  const handle = handleCache.get(sessionKey)
  if (handle) {
    await runtime.close({ handle, reason: "user reset", discardPersistentState: true })
    handleCache.delete(sessionKey)
  }
  await telegram.sendMessage(chatId, "✅ Session reset. Starting fresh.")
  return { ok: true }
}
```

`discardPersistentState: true` tells acpx to delete the session record from its store so the next `ensureSession` creates a genuinely new session, not a reconnect to the old one.

Add `/reset` to the help text.

---

## Session TTL Cleanup

Long-running deployments accumulate stale persistent sessions (users who haven't talked to the bot in weeks). A background cleanup job runs periodically to close sessions idle beyond the TTL.

New file: `scripts/vm/pi-worker-session-cleanup.ts`

```ts
#!/usr/bin/env bun
// Run periodically (e.g. hourly via cron or supervised loop).
// Closes persistent ACP sessions that have been idle for > ACPX_SESSION_TTL_HOURS.

const env = getWorkerEnv()
const sessionDir = join(env.acpx.stateDir, "sessions")
const ttlMs = env.acpx.sessionTtlHours * 3600 * 1000

// Read all session records from acpx store
// For each: if lastActivityAt < (now - ttlMs), call runtime.close({ handle, reason: "ttl" })
// Log which sessions were closed
```

The exact implementation depends on acpx's `AcpSessionStore.load` API for enumerating sessions. If enumeration is not available, fall back to reading the store directory directly (`ls stateDir/sessions/`).

---

## Changes to `env.ts`

Add to `AcpxConfig`:

```ts
export type AcpxConfig = {
  // ... existing fields from PR1 ...
  sessionTtlHours: number     // NEW: default 24
  sessionMode: "oneshot" | "persistent"  // NEW: default "oneshot"
}
```

New env vars:

```ts
acpx: {
  // existing...
  sessionTtlHours: intFromEnv("ACPX_SESSION_TTL_HOURS", 24),
  sessionMode: (process.env.ACPX_SESSION_MODE ?? "oneshot") as "oneshot" | "persistent",
},
```

New `WorkerBackendId`:

```ts
export type WorkerBackendId = "tmux" | "smolvm" | "acpx" | "acpx-runtime" | "acpx-persistent"
```

New case in `backend-registry.ts`:

```ts
case "acpx-persistent":
  return createAcpxPersistentBackend({
    stateDir: options.env.stateDir,
    acpxStateDir: options.env.acpx.stateDir,
    agent: options.env.acpx.agent,
    cwd: options.env.acpx.cwd,
    timeoutMs: options.env.acpx.timeoutMs,
    sessionTtlHours: options.env.acpx.sessionTtlHours,
  })
```

Set `PI_WORKER_BACKEND=acpx-persistent` to enable.

---

## Task Checklist

- [ ] Create `scripts/vm/lib/session-lock.ts`
- [ ] Create `scripts/vm/lib/backends/acpx-persistent-backend.ts`
- [ ] Add `sessionTtlHours`, `sessionMode` to `AcpxConfig` in `env.ts`
- [ ] Add `ACPX_SESSION_TTL_HOURS`, `ACPX_SESSION_MODE` env var reading
- [ ] Add `"acpx-persistent"` to `WorkerBackendId` and `backend-registry.ts`
- [ ] Add `/reset` command to `telegram-poller.ts`
- [ ] Create `scripts/vm/pi-worker-session-cleanup.ts`
- [ ] Write unit tests
- [ ] Manual test: two sequential Telegram messages share context (second response references first)
- [ ] Manual test: `/reset` produces fresh-context response on next message
- [ ] Update `.env.example` with new vars

---

## Test Strategy

File: `scripts/vm/lib/backends/acpx-persistent-backend.test.ts`

**Test 1 — first message creates session:**  
`submitPrompt(job1)` → `ensureSession` called once with `sessionKey: "pi-chatId1"`, `mode: "persistent"`. Handle cached.

**Test 2 — second message reuses handle:**  
`submitPrompt(job2)` with same chatId → `ensureSession` NOT called again. `startTurn` called with same handle.

**Test 3 — session error triggers retry:**  
First `startTurn` resolves `{ status: "failed", error: { code: "ACP_SESSION_NOT_FOUND" } }` → `handleCache` cleared, `ensureSession` called again, `startTurn` retried once. Second turn succeeds.

**Test 4 — concurrent first messages serialized:**  
Two concurrent `submitPrompt` calls for same chatId. `ensureSession` called exactly once. Both turns use the same handle.

**Test 5 — `/reset` closes session and clears cache:**  
After `/reset`, `runtime.close` called with `discardPersistentState: true`. Next `submitPrompt` calls `ensureSession` again.

**Test 6 — cancel in-flight:**  
Same as PR1 test 3 — `turn.cancel()` called, `activeTurns` cleared.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| acpx session store file locking (concurrent writes from multi-process deployments) | Low (single-process typical) | `session-lock.ts` handles intra-process races; document multi-process limitation |
| `discardPersistentState: true` semantics not supported by all ACP agents | Medium | Wrap `/reset` in try/catch; fall back to cache eviction only if close fails |
| Session TTL cleanup runs while a turn is in progress | Low | Cleanup job checks `activeTurns` before closing; skip sessions with active turns |
| Handle cache grows unbounded on a long-running bot with many users | Low (bounded by unique chatIds) | Cache is bounded by distinct chatIds in `TELEGRAM_ALLOWED_CHAT_IDS`; explicit TTL cleanup reduces size |
| Agent process crashes mid-turn — persistent session left in inconsistent state | Medium | Retry logic on `ACP_SESSION_NOT_FOUND`/`ACP_BACKEND_UNAVAILABLE` re-creates session automatically |

---

## Definition of Done

- Two sequential Telegram messages to the same chat (via `PI_WORKER_BACKEND=acpx-persistent`) result in the second response demonstrating knowledge of the first (verified by prompt "what did you just do?").
- `/reset` produces a genuinely fresh context on the next message.
- All 6 unit tests pass.
- `sessionHealth()` returns `ok: true` with persistent backend active.
- `cancel()` is functional.
- Session lock file cleaned up after acquisition even when `ensureSession` throws.
