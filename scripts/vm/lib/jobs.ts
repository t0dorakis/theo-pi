import { randomUUID } from "node:crypto"

import { createStateStore } from "./state-store"
import { leaseExpired, leaseExpiry } from "./job-lease"
import { nowIso } from "./time"
import type { WorkerJob } from "./types"

export type JobQueue = ReturnType<typeof createJobQueue>

export function createJobQueue(stateDir: string, options?: { leaseDurationSeconds?: number; backend?: string; resultFormat?: string }) {
  const stateStore = createStateStore(stateDir)
  const leaseDurationSeconds = options?.leaseDurationSeconds ?? 300
  const backend = options?.backend ?? "tmux"
  const resultFormat = options?.resultFormat ?? "text"

  async function allJobs() {
    const jobs = await stateStore.listTelegramJobs()
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async function nextSequence(chatId: string) {
    const jobs = await allJobs()
    return jobs.filter((job) => String(job.chatId) === chatId).reduce((max, job) => Math.max(max, Number(job.sequence ?? 0)), 0) + 1
  }

  async function save(job: WorkerJob) {
    await stateStore.writeTelegramJob(job)
    return job
  }

  return {
    async enqueueJob(input: { chatId: string; prompt: string; createdAt?: string }) {
      const createdAt = input.createdAt ?? nowIso()
      const id = `${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`
      const job: WorkerJob = {
        id,
        chatId: input.chatId,
        prompt: input.prompt,
        status: "pending",
        createdAt,
        startedAt: null,
        completedAt: null,
        answer: null,
        error: null,
        sequence: await nextSequence(input.chatId),
        telegramDeliveredAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        backend,
        resultFormat,
      }
      return save(job)
    },
    async claimNextJob(leaseOwner: string, claimedAt: string = nowIso()) {
      const jobs = await allJobs()
      const next = jobs.find((job) => job.status === "pending" && !job.telegramDeliveredAt)
      if (!next) return null
      next.status = "running"
      next.startedAt = next.startedAt ?? claimedAt
      next.error = null
      next.leaseOwner = leaseOwner
      next.leaseExpiresAt = leaseExpiry(claimedAt, leaseDurationSeconds)
      return save(next)
    },
    async claimJob(jobId: string, leaseOwner: string, claimedAt: string = nowIso()) {
      const job = await stateStore.readTelegramJob(jobId)
      if (!job || job.status !== "pending" || job.telegramDeliveredAt) return null
      job.status = "running"
      job.startedAt = job.startedAt ?? claimedAt
      job.error = null
      job.leaseOwner = leaseOwner
      job.leaseExpiresAt = leaseExpiry(claimedAt, leaseDurationSeconds)
      return save(job)
    },
    async heartbeatLease(jobId: string, fromIso: string = nowIso()) {
      const job = await stateStore.readTelegramJob(jobId)
      if (!job) return null
      job.leaseExpiresAt = leaseExpiry(fromIso, leaseDurationSeconds)
      return save(job)
    },
    async completeJob(jobId: string, answer: string, completedAt: string = nowIso()) {
      const job = await stateStore.readTelegramJob(jobId)
      if (!job) return null
      job.status = "done"
      job.answer = answer
      job.error = null
      job.completedAt = completedAt
      job.leaseOwner = null
      job.leaseExpiresAt = null
      return save(job)
    },
    async failJob(jobId: string, error: string, completedAt: string = nowIso()) {
      const job = await stateStore.readTelegramJob(jobId)
      if (!job) return null
      job.status = "failed"
      job.error = error
      job.completedAt = completedAt
      job.leaseOwner = null
      job.leaseExpiresAt = null
      return save(job)
    },
    async markDelivered(jobId: string, deliveredAt: string = nowIso()) {
      const job = await stateStore.readTelegramJob(jobId)
      if (!job) return null
      job.telegramDeliveredAt = deliveredAt
      return save(job)
    },
    async reapExpiredLeases(now: string = nowIso()) {
      const jobs = await allJobs()
      const expired = jobs.filter((job) => job.status === "running" && leaseExpired(job.leaseExpiresAt, now))
      for (const job of expired) {
        job.status = "pending"
        job.leaseOwner = null
        job.leaseExpiresAt = null
        job.startedAt = null
        await save(job)
      }
      return expired.length
    },
    async listJobs() {
      return allJobs()
    },
    async getJob(jobId: string) {
      return stateStore.readTelegramJob(jobId)
    },
  }
}
