import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { readJsonFile, writeJsonFile } from "./json-file"
import { getRuntimePaths } from "./paths"
import type { HealthState, SessionState, WorkerJob } from "./types"

type JobRequestRecord = {
  id: string
  backendId: string
  createdAt?: string
  acceptedAt?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: string | null
  resultChannel?: string | null
  request: { prompt: string }
}

type JobResultRecord = {
  id: string
  backendId: string
  status: "done" | "failed"
  answer?: string | null
  error?: string | null
  completedAt: string
}

function normalizeJob(job: WorkerJob): WorkerJob {
  return {
    ...job,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    answer: job.answer ?? null,
    error: job.error ?? null,
    telegramDeliveredAt: job.telegramDeliveredAt ?? null,
    leaseOwner: job.leaseOwner ?? null,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    backend: job.backend ?? null,
    resultFormat: job.resultFormat ?? null,
  }
}

export function createStateStore(stateDir: string) {
  const paths = getRuntimePaths(stateDir, import.meta.url)

  return {
    paths,
    async readHealth() {
      return readJsonFile<HealthState>(join(stateDir, "health.json"))
    },
    async writeHealth(health: HealthState) {
      await writeJsonFile(join(stateDir, "health.json"), health)
    },
    async readHeartbeat() {
      return readJsonFile<Record<string, unknown>>(join(stateDir, "heartbeat.json"))
    },
    async writeHeartbeat(heartbeat: Record<string, unknown>) {
      await writeJsonFile(join(stateDir, "heartbeat.json"), heartbeat)
    },
    async readState() {
      return readJsonFile<SessionState>(join(stateDir, "state.json"))
    },
    async writeState(state: SessionState) {
      await writeJsonFile(join(stateDir, "state.json"), state)
    },
    async readSessionState(sessionName: string) {
      return readJsonFile<SessionState>(join(stateDir, "sessions", `${sessionName}.json`))
    },
    async writeSessionState(session: SessionState) {
      await writeJsonFile(join(stateDir, "sessions", `${session.activeSessionName}.json`), session)
      await writeJsonFile(join(stateDir, "state.json"), session)
    },
    async readTelegramJob(id: string) {
      const job = await readJsonFile<WorkerJob>(join(paths.telegramJobsDir, `${id}.json`))
      return job ? normalizeJob(job) : null
    },
    async writeTelegramJob(job: WorkerJob) {
      await writeJsonFile(join(paths.telegramJobsDir, `${job.id}.json`), normalizeJob(job))
    },
    async listTelegramJobs() {
      const files = await readdir(paths.telegramJobsDir).catch(() => [])
      const jobs = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => readJsonFile<WorkerJob>(join(paths.telegramJobsDir, file))),
      )
      return jobs.filter((job): job is WorkerJob => Boolean(job)).map(normalizeJob)
    },
    async readJobRequest(id: string) {
      return readJsonFile<JobRequestRecord>(join(paths.jobRequestsDir, `${id}.json`))
    },
    async writeJobRequest(request: JobRequestRecord) {
      await writeJsonFile(join(paths.jobRequestsDir, `${request.id}.json`), request)
    },
    async readJobResult(id: string) {
      return readJsonFile<JobResultRecord>(join(paths.jobResultsDir, `${id}.json`))
    },
    async writeJobResult(result: JobResultRecord) {
      await writeJsonFile(join(paths.jobResultsDir, `${result.id}.json`), result)
    },
    async writeRawJobResult(id: string, value: unknown) {
      await writeJsonFile(join(paths.jobResultsDir, `${id}.json`), value)
    },
  }
}
