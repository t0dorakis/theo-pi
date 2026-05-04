import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { acquireSessionLock } from "./session-lock"
import { createAcpxBackend } from "./backends/acpx-backend"
import { getRuntimeEnv, type RuntimeEnv } from "./env"
import { createJobQueue } from "./jobs"
import { getRuntimePaths } from "./paths"
import { createResultChannel } from "./result-channel"

export type WorkerRunResult =
  | { status: "done"; answer: string; jobId: string; resultPath: string }
  | { status: "failed"; error: string; jobId: string; resultPath: string }

const runtimeCache = new Map<string, ReturnType<typeof createAcpxRuntimeUncached>>()

function runtimeCacheKey(env: RuntimeEnv) {
  return JSON.stringify({
    stateDir: env.stateDir,
    acpxStateDir: env.acpx.stateDir,
    agent: env.acpx.agent,
    cwd: env.acpx.cwd,
    timeoutMs: env.acpx.timeoutMs,
    sessionMode: env.acpx.sessionMode,
  })
}

function createAcpxRuntimeUncached(env: RuntimeEnv) {
  return createAcpxBackend({
    stateDir: env.stateDir,
    acpxStateDir: env.acpx.stateDir,
    agent: env.acpx.agent,
    cwd: env.acpx.cwd,
    timeoutMs: env.acpx.timeoutMs,
    sessionMode: env.acpx.sessionMode,
    sessionTtlHours: env.acpx.sessionTtlHours,
  })
}

function createAcpxRuntime(env: RuntimeEnv) {
  const key = runtimeCacheKey(env)
  const cached = runtimeCache.get(key)
  if (cached) return cached
  const runtime = createAcpxRuntimeUncached(env)
  runtimeCache.set(key, runtime)
  return runtime
}

function cancelPath(env: RuntimeEnv, jobId: string) {
  return join(getRuntimePaths(env.stateDir, import.meta.url).jobCancelsDir, `${jobId}.cancel`)
}

async function cancelRequested(env: RuntimeEnv, jobId: string) {
  return Boolean(await readFile(cancelPath(env, jobId), "utf8").catch(() => null))
}

function turnLockKey(env: RuntimeEnv, job: { id: string; chatId: string }) {
  return env.acpx.sessionMode === "persistent"
    ? `acpx-turn-${env.acpx.agent}-${job.chatId}`
    : `acpx-turn-${job.id}`
}

export async function runQueuedJob(jobId: string, env: RuntimeEnv = getRuntimeEnv()): Promise<WorkerRunResult> {
  const runnerId = `runner-${env.session}-${process.pid}`
  const leaseDurationSeconds = Math.max(env.jobTimeoutSeconds, Math.ceil(env.acpx.timeoutMs / 1000)) + 120
  const queue = createJobQueue(env.stateDir, { backend: "acpx", leaseDurationSeconds })
  const resultChannel = createResultChannel(env.stateDir)
  const runtime = createAcpxRuntime(env)
  const resultPath = resultChannel.resultPath(jobId)

  const initial = await queue.getJob(jobId)
  if (!initial) throw new Error(`job not found: ${jobId}`)
  const releaseRunLock = await acquireSessionLock(env.stateDir, turnLockKey(env, initial), Math.max(env.jobTimeoutSeconds * 1000, env.acpx.timeoutMs) + 60_000)

  try {
    const existing = await queue.getJob(jobId)
    if (!existing) throw new Error(`job not found: ${jobId}`)
    if (existing.status === "running") {
      throw new Error(`job already running: ${jobId} (leaseOwner=${existing.leaseOwner ?? "unknown"})`)
    }

    const job = await queue.claimJob(jobId, runnerId)
    if (!job) throw new Error(`job not claimable: ${jobId}`)

    const heartbeatIntervalMs = Math.max(1000, Math.min(env.jobPollIntervalMs, 30_000))
    let heartbeatFailureLogged = false
    let cancelSent = false
    const heartbeat = setInterval(() => {
      void (async () => {
        try {
          await queue.heartbeatLease(job.id)
          if (!cancelSent && await cancelRequested(env, job.id)) {
            cancelSent = true
            await runtime.cancel(job.id)
          }
        } catch (error) {
          if (!heartbeatFailureLogged) {
            heartbeatFailureLogged = true
            console.error(`heartbeat/cancel check failed for ${job.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      })()
    }, heartbeatIntervalMs)
    heartbeat.unref?.()

    try {
      await resultChannel.writeRequest({
        id: job.id,
        backendId: "acpx",
        prompt: job.prompt,
        acceptedAt: new Date().toISOString(),
        leaseOwner: runnerId,
        leaseExpiresAt: job.leaseExpiresAt ?? null,
      })

      await runtime.submitPrompt(job)
      const result = await resultChannel.readResult(job.id)
      if (result.status === "done") {
        const answer = result.answer?.trim() ?? ""
        if (!answer) {
          const error = "acpx job produced empty answer"
          await resultChannel.writeResult({
            id: job.id,
            backendId: "acpx",
            status: "failed",
            error,
            completedAt: new Date().toISOString(),
          })
          await queue.failJob(job.id, error)
          return { status: "failed", error, jobId: job.id, resultPath }
        }
        await queue.completeJob(job.id, answer)
        return { status: "done", answer, jobId: job.id, resultPath }
      }

      const error = result.error ?? "acpx job failed"
      await queue.failJob(job.id, error)
      return { status: "failed", error, jobId: job.id, resultPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const existingResult = await resultChannel.readResult(job.id).catch(() => null)
      if (!existingResult) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx",
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
        })
      }
      await queue.failJob(job.id, message)
      return { status: "failed", error: message, jobId: job.id, resultPath }
    } finally {
      clearInterval(heartbeat)
      await unlink(cancelPath(env, job.id)).catch(() => {})
    }
  } finally {
    await releaseRunLock()
  }
}

export async function requestCancelJobsForChat(chatId: string, env: RuntimeEnv = getRuntimeEnv()) {
  const queue = createJobQueue(env.stateDir, { backend: "acpx" })
  const paths = getRuntimePaths(env.stateDir, import.meta.url)
  await mkdir(paths.jobCancelsDir, { recursive: true })
  const jobs = await queue.listJobs()
  const running = jobs.filter((job) => job.chatId === chatId && job.status === "running")
  for (const job of running) {
    await writeFile(cancelPath(env, job.id), `reset requested ${new Date().toISOString()}\n`, "utf8")
  }
  return running.map((job) => job.id)
}

export async function getWorkerRuntimeHealth(env: RuntimeEnv = getRuntimeEnv()) {
  const runtime = createAcpxRuntime(env)
  return runtime.sessionHealth()
}

export async function resetWorkerChatSession(chatId: string, env: RuntimeEnv = getRuntimeEnv()) {
  const runtime = createAcpxRuntime(env)
  await runtime.resetChatSession(chatId)
}
