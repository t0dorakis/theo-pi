/**
 * ACPX runtime adapter — bridges WorkerJob records to acpx/runtime.
 *
 * One adapter supports two ACP session modes:
 *
 *   "oneshot"    — fresh session per job (default). Stateless, no context.
 *   "persistent" — one session per chat. Agent accumulates conversation context.
 *
 * Select session behavior with ACPX_SESSION_MODE=oneshot|persistent.
 * Queue state remains lifecycle authority; result/event files are artifacts.
 */

import { createAcpxEventLog } from "../acpx-event-log"
import { createResultChannel } from "../result-channel"
import { acquireSessionLock } from "../session-lock"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"
import type { AcpRuntimeTurnResult } from "acpx/runtime"

export type AcpxRuntimeAdapterOptions = {
  stateDir: string
  acpxStateDir: string
  agent: string
  /** Overrides the registry launch command for `agent` (e.g. newer adapter pin). */
  agentCommand?: string
  cwd: string | undefined
  timeoutMs: number
  sessionMode: "oneshot" | "persistent"
  /** Informational: TTL hours for idle persistent sessions (used by future cleanup). */
  sessionTtlHours?: number
}

type AcpMod = typeof import("acpx/runtime")
type AcpRuntimeHandle = import("acpx/runtime").AcpRuntimeHandle
type AcpxRuntime = import("acpx/runtime").AcpxRuntime

type AcpxRuntimeAdapter = {
  submitPrompt(job: WorkerJob): Promise<void>
  readResult(job: WorkerJob): Promise<string | null>
  sessionHealth(): Promise<{ ok: boolean; detail?: string }>
  cancel(jobId: string): Promise<void>
  resetChatSession(chatId: string): Promise<void>
}

const SESSION_RETRY_ERROR_CODES = new Set([
  "ACP_SESSION_INIT_FAILED",
  "ACP_BACKEND_UNAVAILABLE",
  "ACP_BACKEND_MISSING",
])

export function createAcpxRuntimeAdapter(options: AcpxRuntimeAdapterOptions): AcpxRuntimeAdapter {
  const resultChannel = createResultChannel(options.stateDir)
  const eventLog = createAcpxEventLog(options.stateDir)
  const activeTurns = new Map<string, () => Promise<void>>()

  // Handle cache for persistent mode — local to closure, not module-level.
  const handleCache = new Map<string, AcpRuntimeHandle>()

  let modPromise: Promise<AcpMod> | null = null
  let runtimePromise: Promise<AcpxRuntime> | null = null

  async function getMod(): Promise<AcpMod> {
    if (!modPromise) {
      modPromise = import("acpx/runtime").catch((e) => {
        throw new Error(`acpx not installed. Run: npm install acpx — ${e instanceof Error ? e.message : e}`)
      })
    }
    return modPromise
  }

  async function getRuntime(): Promise<AcpxRuntime> {
    if (!runtimePromise) {
      runtimePromise = getMod().then(({ AcpxRuntime, createAgentRegistry, createFileSessionStore }) =>
        new AcpxRuntime({
          cwd: options.cwd ?? process.cwd(),
          sessionStore: createFileSessionStore({ stateDir: options.acpxStateDir }),
          agentRegistry: createAgentRegistry(
            options.agentCommand ? { overrides: { [options.agent]: options.agentCommand } } : undefined,
          ),
          permissionMode: "approve-all",
          timeoutMs: options.timeoutMs,
        })
      )
    }
    return runtimePromise
  }

  function sessionKeyFor(job: WorkerJob) {
    return options.sessionMode === "persistent" ? `${options.agent}-${job.chatId}` : job.id
  }

  async function getHandle(job: WorkerJob, _mod: AcpMod): Promise<AcpRuntimeHandle> {
    const runtime = await getRuntime()

    if (options.sessionMode === "oneshot") {
      return runtime.ensureSession({ sessionKey: job.id, agent: options.agent, mode: "oneshot", cwd: options.cwd })
    }

    // Persistent: session key scoped by agent + chatId to avoid cross-agent bleed.
    const sessionKey = sessionKeyFor(job)
    const cached = handleCache.get(sessionKey)
    if (cached) return cached

    // Serialize concurrent first-message calls for the same chat.
    const release = await acquireSessionLock(options.stateDir, sessionKey)
    try {
      // Re-check after acquiring lock — another coroutine may have created it.
      const existing = handleCache.get(sessionKey)
      if (existing) return existing

      const handle = await runtime.ensureSession({ sessionKey, agent: options.agent, mode: "persistent", cwd: options.cwd })
      handleCache.set(sessionKey, handle)
      return handle
    } finally {
      await release()
    }
  }

  function isRetryableSessionResult(result: AcpRuntimeTurnResult) {
    return options.sessionMode === "persistent" &&
      result.status === "failed" &&
      result.error.code != null &&
      SESSION_RETRY_ERROR_CODES.has(result.error.code)
  }

  async function runAttempt(input: {
    job: WorkerJob
    runtime: AcpxRuntime
    handle: AcpRuntimeHandle
    attempt: "initial" | "retry"
    requestId: string
  }): Promise<{ result: AcpRuntimeTurnResult; answer: string; hadOutput: boolean }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    timeout.unref?.()
    const turn = input.runtime.startTurn({
      handle: input.handle,
      text: input.job.prompt,
      mode: "prompt",
      requestId: input.requestId,
      timeoutMs: options.timeoutMs,
      signal: controller.signal,
    })
    activeTurns.set(input.job.id, async () => {
      controller.abort()
      await turn.cancel({ reason: "worker cancel" })
    })

    const chunks: string[] = []
    try {
      for await (const event of turn.events) {
        await eventLog.append(input.job.id, input.attempt, event, { format: "acpx-runtime-event-v1" })
        if (event.type === "text_delta" && event.stream !== "thought") chunks.push(event.text)
      }
      const result = await turn.result
      await eventLog.appendPayload(input.job.id, input.attempt, "pi-worker-turn-result-v1", result, { legacyEvent: { type: "turn_result", result } })
      const answer = chunks.join("").trim()
      return { result, answer, hadOutput: answer.length > 0 }
    } finally {
      clearTimeout(timeout)
    }
  }

  async function writeFailure(job: WorkerJob, error: string) {
    await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error, completedAt: nowIso() })
  }

  async function writeDone(job: WorkerJob, answer: string) {
    await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "done", answer, completedAt: nowIso() })
  }

  async function retryWithFreshSession(job: WorkerJob, runtime: AcpxRuntime, mod: AcpMod) {
    handleCache.delete(sessionKeyFor(job))
    const freshHandle = await getHandle(job, mod)
    const retry = await runAttempt({
      job,
      runtime,
      handle: freshHandle,
      attempt: "retry",
      requestId: `${job.id}-retry`,
    })
    if (retry.result.status === "completed") {
      await writeDone(job, retry.answer)
      return true
    }
    const error = retry.result.status === "failed"
      ? `${retry.result.error.message} (${retry.result.error.code ?? "unknown"})`
      : `retry ${retry.result.status}: ${retry.result.stopReason ?? ""}`
    await writeFailure(job, error)
    return true
  }

  async function runTurn(job: WorkerJob): Promise<void> {
    const mod = await getMod()
    const { AcpRuntimeError } = mod

    let handle: AcpRuntimeHandle
    try {
      handle = await getHandle(job, mod)
      await eventLog.appendPayload(job.id, "session", "pi-worker-session-ready-v1", {
        sessionKey: handle.sessionKey,
        acpxRecordId: handle.acpxRecordId,
        backendSessionId: handle.backendSessionId,
        agentSessionId: handle.agentSessionId,
        cwd: handle.cwd,
      }, { legacyEvent: {
        type: "session_ready",
        sessionKey: handle.sessionKey,
        acpxRecordId: handle.acpxRecordId,
        backendSessionId: handle.backendSessionId,
        agentSessionId: handle.agentSessionId,
        cwd: handle.cwd,
      } })
    } catch (e) {
      const msg = e instanceof AcpRuntimeError ? `AcpRuntimeError(${e.code}): ${e.message}` : String(e)
      await eventLog.appendPayload(job.id, "session", "pi-worker-session-error-v1", { error: msg }, { legacyEvent: { type: "session_error", error: msg } })
      await writeFailure(job, msg)
      return
    }

    const runtime = await getRuntime()
    try {
      const attempt = await runAttempt({ job, runtime, handle, attempt: "initial", requestId: job.id })

      if (attempt.result.status === "completed") {
        await writeDone(job, attempt.answer)
      } else if (attempt.result.status === "cancelled") {
        await writeFailure(job, `cancelled: ${attempt.result.stopReason ?? ""}`)
      } else if (isRetryableSessionResult(attempt.result)) {
        if (attempt.hadOutput) {
          await writeFailure(job, "retry skipped after partial output from failed attempt")
          return
        }
        await retryWithFreshSession(job, runtime, mod).catch(async (error) => {
          const msg = error instanceof AcpRuntimeError ? `AcpRuntimeError(${error.code}): ${error.message}` : String(error)
          await eventLog.appendPayload(job.id, "retry", "pi-worker-retry-error-v1", { error: msg }, { legacyEvent: { type: "retry_error", error: msg } })
          await writeFailure(job, msg)
        })
      } else {
        await writeFailure(job, `${attempt.result.error.message} (${attempt.result.error.code ?? "unknown"})`)
      }
    } catch (e) {
      // On session errors in persistent mode, evict cache and retry once with a fresh session.
      if (options.sessionMode === "persistent" && e instanceof AcpRuntimeError) {
        try {
          await retryWithFreshSession(job, runtime, mod)
          return
        } catch (retryError) {
          const msg = retryError instanceof AcpRuntimeError ? `AcpRuntimeError(${retryError.code}): ${retryError.message}` : String(retryError)
          await eventLog.appendPayload(job.id, "retry", "pi-worker-retry-error-v1", { error: msg }, { legacyEvent: { type: "retry_error", error: msg } })
          await writeFailure(job, msg)
          return
        }
      }
      const msg = e instanceof AcpRuntimeError ? `AcpRuntimeError(${e.code}): ${e.message}` : String(e)
      await eventLog.appendPayload(job.id, "initial", "pi-worker-turn-exception-v1", { error: msg }, { legacyEvent: { type: "turn_exception", error: msg } })
      await writeFailure(job, msg)
    } finally {
      activeTurns.delete(job.id)
    }
  }

  return {
    submitPrompt: (job) => runTurn(job),

    async readResult(job: WorkerJob) {
      const result = await resultChannel.readResult(job.id).catch(() => null)
      if (!result) return null
      if (result.status === "failed") throw new Error(result.error ?? "acpx job failed")
      return result.answer ?? null
    },

    async sessionHealth() {
      try {
        const runtime = await getRuntime()
        if (typeof (runtime as { doctor?: unknown }).doctor !== "function") return { ok: true }
        const report = await runtime.doctor()
        return { ok: report.ok, detail: report.message }
      } catch (e) {
        return { ok: false, detail: String(e) }
      }
    },

    async cancel(jobId: string) {
      const fn = activeTurns.get(jobId)
      if (fn) { await fn(); activeTurns.delete(jobId) }
    },

    async resetChatSession(chatId: string) {
      const mod = await getMod()
      const runtime = await getRuntime()
      const sessionKey = `${options.agent}-${chatId}`
      const cached = handleCache.get(sessionKey)
      const handle = cached ?? await runtime.ensureSession({ sessionKey, agent: options.agent, mode: "persistent", cwd: options.cwd })
      try {
        await runtime.close({ handle, reason: "worker reset", discardPersistentState: true })
      } catch (e) {
        // Agents without ACP session/close (e.g. codex) throw before the
        // record is flagged for reset, so the old session would be resumed
        // on the next message. Flag the stored record directly instead.
        if (!(e instanceof mod.AcpRuntimeError) || e.code !== "ACP_BACKEND_UNSUPPORTED_CONTROL") throw e
        const store = mod.createFileSessionStore({ stateDir: options.acpxStateDir })
        const record = await store.load(sessionKey)
        if (record) {
          record.acpx = { ...record.acpx, reset_on_next_ensure: true }
          record.closed = true
          record.closedAt = new Date().toISOString()
          await store.save(record)
        }
      } finally {
        handleCache.delete(sessionKey)
      }
    },
  }
}
