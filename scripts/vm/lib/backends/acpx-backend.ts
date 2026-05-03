/**
 * acpx backend — in-process ACP agent via acpx/runtime.
 *
 * Replaces three previous acpx variants (subprocess exec, acpx-runtime,
 * acpx-persistent) with one backend controlled by sessionMode:
 *
 *   "oneshot"    — fresh session per job (default). Stateless, no context.
 *   "persistent" — one session per chat. Agent accumulates conversation context.
 *
 * Select via PI_WORKER_BACKEND=acpx + ACPX_SESSION_MODE=oneshot|persistent.
 */

import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { acquireSessionLock } from "../session-lock"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"

export type AcpxBackendOptions = {
  stateDir: string
  acpxStateDir: string
  agent: string
  cwd: string | undefined
  timeoutMs: number
  sessionMode: "oneshot" | "persistent"
  /** Informational: TTL hours for idle persistent sessions (used by future cleanup). */
  sessionTtlHours?: number
}

type AcpMod = typeof import("acpx/runtime")

export function createAcpxBackend(options: AcpxBackendOptions): WorkerBackend {
  const resultChannel = createResultChannel(options.stateDir)
  const activeTurns = new Map<string, () => Promise<void>>()

  // Handle cache for persistent mode — local to closure, not module-level.
  const handleCache = new Map<string, import("acpx/runtime").AcpRuntimeHandle>()

  let modPromise: Promise<AcpMod> | null = null
  let runtimePromise: Promise<import("acpx/runtime").AcpxRuntime> | null = null

  async function getMod(): Promise<AcpMod> {
    if (!modPromise) {
      modPromise = import("acpx/runtime").catch((e) => {
        throw new Error(`acpx not installed. Run: npm install acpx — ${e instanceof Error ? e.message : e}`)
      })
    }
    return modPromise
  }

  async function getRuntime(): Promise<import("acpx/runtime").AcpxRuntime> {
    if (!runtimePromise) {
      runtimePromise = getMod().then(({ AcpxRuntime, createAgentRegistry, createFileSessionStore }) =>
        new AcpxRuntime({
          cwd: options.cwd ?? process.cwd(),
          sessionStore: createFileSessionStore({ stateDir: options.acpxStateDir }),
          agentRegistry: createAgentRegistry(),
          permissionMode: "approve-all",
          timeoutMs: options.timeoutMs,
        })
      )
    }
    return runtimePromise
  }

  async function getHandle(job: WorkerJob, mod: AcpMod): Promise<import("acpx/runtime").AcpRuntimeHandle> {
    const runtime = await getRuntime()
    const { AcpRuntimeError } = mod

    if (options.sessionMode === "oneshot") {
      return runtime.ensureSession({ sessionKey: job.id, agent: options.agent, mode: "oneshot", cwd: options.cwd })
    }

    // Persistent: session key scoped by agent + chatId to avoid cross-agent bleed.
    const sessionKey = `${options.agent}-${job.chatId}`
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
    } catch (e) {
      if (e instanceof AcpRuntimeError) throw e
      throw e
    } finally {
      await release()
    }
  }

  async function runTurn(job: WorkerJob): Promise<void> {
    const mod = await getMod()
    const { AcpRuntimeError } = mod
    const sessionKey = options.sessionMode === "persistent" ? `${options.agent}-${job.chatId}` : job.id

    let handle: import("acpx/runtime").AcpRuntimeHandle
    try {
      handle = await getHandle(job, mod)
    } catch (e) {
      const msg = e instanceof AcpRuntimeError ? `AcpRuntimeError(${e.code}): ${e.message}` : String(e)
      await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: msg, completedAt: nowIso() })
      return
    }

    const runtime = await getRuntime()
    const turn = runtime.startTurn({ handle, text: job.prompt, mode: "prompt", requestId: job.id, timeoutMs: options.timeoutMs })
    activeTurns.set(job.id, () => turn.cancel({ reason: "worker cancel" }))

    const chunks: string[] = []
    try {
      for await (const event of turn.events) {
        if (event.type === "text_delta" && event.stream !== "thought") chunks.push(event.text)
      }
      const result = await turn.result

      if (result.status === "completed") {
        await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "done", answer: chunks.join("").trim(), completedAt: nowIso() })
      } else if (result.status === "cancelled") {
        await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: `cancelled: ${result.stopReason ?? ""}`, completedAt: nowIso() })
      } else {
        // On session errors in persistent mode, evict cache and retry once.
        const isSessionError = options.sessionMode === "persistent" &&
          result.error.code != null &&
          ["ACP_SESSION_INIT_FAILED", "ACP_BACKEND_UNAVAILABLE", "ACP_BACKEND_MISSING"].includes(result.error.code)
        if (isSessionError) {
          handleCache.delete(sessionKey)
          try {
            const freshHandle = await getHandle(job, mod)
            const retry = runtime.startTurn({ handle: freshHandle, text: job.prompt, mode: "prompt", requestId: `${job.id}-retry`, timeoutMs: options.timeoutMs })
            const retryChunks: string[] = []
            for await (const ev of retry.events) {
              if (ev.type === "text_delta" && ev.stream !== "thought") retryChunks.push(ev.text)
            }
            const retryResult = await retry.result
            if (retryResult.status === "completed") {
              await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "done", answer: retryChunks.join("").trim(), completedAt: nowIso() })
            } else {
              await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: "retry failed", completedAt: nowIso() })
            }
            return
          } catch { /* fall through */ }
        }
        await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: `${result.error.message} (${result.error.code ?? "unknown"})`, completedAt: nowIso() })
      }
    } catch (e) {
      // On session errors in persistent mode, evict cache and retry once with a fresh session.
      if (options.sessionMode === "persistent" && e instanceof AcpRuntimeError) {
        handleCache.delete(sessionKey)
        try {
          const freshHandle = await getHandle(job, mod)
          const retry = runtime.startTurn({ handle: freshHandle, text: job.prompt, mode: "prompt", requestId: `${job.id}-retry`, timeoutMs: options.timeoutMs })
          const retryChunks: string[] = []
          for await (const ev of retry.events) {
            if (ev.type === "text_delta" && ev.stream !== "thought") retryChunks.push(ev.text)
          }
          const retryResult = await retry.result
          if (retryResult.status === "completed") {
            await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "done", answer: retryChunks.join("").trim(), completedAt: nowIso() })
          } else {
            await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: "retry failed", completedAt: nowIso() })
          }
          return
        } catch {
          // retry also failed — fall through to error write below
        }
      }
      const msg = e instanceof AcpRuntimeError ? `AcpRuntimeError(${e.code}): ${e.message}` : String(e)
      await resultChannel.writeResult({ id: job.id, backendId: "acpx", status: "failed", error: msg, completedAt: nowIso() })
    } finally {
      activeTurns.delete(job.id)
    }
  }

  return {
    submitPrompt: (job) => runTurn(job),

    async readResult(job) {
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

    async cancel(jobId) {
      const fn = activeTurns.get(jobId)
      if (fn) { await fn(); activeTurns.delete(jobId) }
    },
  }
}
