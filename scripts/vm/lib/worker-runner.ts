import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { acquireSessionLock } from "./session-lock"
import { createAcpxRuntimeAdapter } from "./acpx/runtime-adapter"
import { getWorkerEnv, type WorkerEnv } from "./env"
import { createJobQueue } from "./jobs"
import { getRuntimePaths } from "./paths"
import { createResultChannel } from "./result-channel"
import { syncWorkspaceToOrigin, type WorkspaceGitSyncResult } from "./workspace-git"

export type WorkerRunResult =
  | { status: "done"; answer: string; jobId: string; resultPath: string }
  | { status: "failed"; error: string; jobId: string; resultPath: string }

const runtimeCache = new Map<string, ReturnType<typeof createAcpxRuntimeUncached>>()

function runtimeCacheKey(env: WorkerEnv) {
  return JSON.stringify({
    stateDir: env.stateDir,
    acpxStateDir: env.acpx.stateDir,
    agent: env.acpx.agent,
    agentCommand: env.acpx.agentCommand,
    cwd: env.acpx.cwd,
    timeoutMs: env.acpx.timeoutMs,
    sessionMode: env.acpx.sessionMode,
  })
}

function createAcpxRuntimeUncached(env: WorkerEnv) {
  return createAcpxRuntimeAdapter({
    stateDir: env.stateDir,
    acpxStateDir: env.acpx.stateDir,
    agent: env.acpx.agent,
    agentCommand: env.acpx.agentCommand,
    cwd: env.acpx.cwd,
    timeoutMs: env.acpx.timeoutMs,
    sessionMode: env.acpx.sessionMode,
    sessionTtlHours: env.acpx.sessionTtlHours,
  })
}

function createAcpxRuntime(env: WorkerEnv) {
  const key = runtimeCacheKey(env)
  const cached = runtimeCache.get(key)
  if (cached) return cached
  const runtime = createAcpxRuntimeUncached(env)
  runtimeCache.set(key, runtime)
  return runtime
}

function cancelPath(env: WorkerEnv, jobId: string) {
  return join(getRuntimePaths(env.stateDir, import.meta.url).jobCancelsDir, `${jobId}.cancel`)
}

async function cancelRequested(env: WorkerEnv, jobId: string) {
  return Boolean(await readFile(cancelPath(env, jobId), "utf8").catch(() => null))
}

function turnLockKey(env: WorkerEnv, job: { id: string; chatId: string }) {
  return env.acpx.sessionMode === "persistent"
    ? `acpx-turn-${env.acpx.agent}-${job.chatId}`
    : `acpx-turn-${job.id}`
}

export async function runQueuedJob(jobId: string, env: WorkerEnv = getWorkerEnv()): Promise<WorkerRunResult> {
  const runnerId = `runner-${env.workerName}-${process.pid}`
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

    if (await cancelRequested(env, job.id)) {
      const error = "job canceled before start"
      await resultChannel.writeResult({
        id: job.id,
        backendId: "acpx",
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      })
      await queue.failJob(job.id, error)
      await unlink(cancelPath(env, job.id)).catch(() => {})
      return { status: "failed", error, jobId: job.id, resultPath }
    }

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

export async function requestCancelJob(jobId: string, reason = "cancel requested", env: WorkerEnv = getWorkerEnv()) {
  const paths = getRuntimePaths(env.stateDir, import.meta.url)
  await mkdir(paths.jobCancelsDir, { recursive: true })
  await writeFile(cancelPath(env, jobId), `${reason} ${new Date().toISOString()}\n`, "utf8")
}

export async function requestCancelJobsForChat(chatId: string, env: WorkerEnv = getWorkerEnv()) {
  const queue = createJobQueue(env.stateDir, { backend: "acpx" })
  const paths = getRuntimePaths(env.stateDir, import.meta.url)
  await mkdir(paths.jobCancelsDir, { recursive: true })
  const jobs = await queue.listJobs()
  const cancellable = jobs.filter((job) => job.chatId === chatId && (job.status === "running" || job.status === "pending"))
  for (const job of cancellable) {
    await requestCancelJob(job.id, "reset requested", env)
  }
  return cancellable.map((job) => job.id)
}

export async function getAcpxRuntimeHealth(env: WorkerEnv = getWorkerEnv()) {
  const runtime = createAcpxRuntime(env)
  return runtime.sessionHealth()
}

export async function resetWorkerChatSession(chatId: string, env: WorkerEnv = getWorkerEnv()) {
  const runtime = createAcpxRuntime(env)
  let gitSync: WorkspaceGitSyncResult
  try {
    await runtime.resetChatSession(chatId)
  } finally {
    // A reset means "clean slate": bring the workspace to the latest pushed
    // state even when closing the acpx session fails.
    gitSync = await syncWorkspaceToOrigin(env.acpx.cwd)
  }
  return { gitSync }
}
