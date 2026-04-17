import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HealthState, SessionState, WorkerJob } from "./types"
import { createStateStore } from "./state-store"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test("writes and reads health state atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-state-store-"))
  tempDirs.push(root)
  const store = createStateStore(root)

  const health: HealthState = {
    ok: true,
    daemonStatus: "running",
    sessionName: "theo-pi",
    workspacePath: "/tmp/workspace",
    pid: 123,
    restartCount: 1,
    lastHeartbeatAt: "2026-04-16T10:00:00Z",
    lastSuccessAt: "2026-04-16T10:00:00Z",
    bootstrapVersion: "2026-04-16.1",
    notes: [],
  }

  await store.writeHealth(health)
  await expect(store.readHealth()).resolves.toEqual(health)
})

test("normalizes null job fields on read", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-state-store-"))
  tempDirs.push(root)
  const store = createStateStore(root)

  const job: WorkerJob = {
    id: "job-1",
    chatId: "123",
    prompt: "ping",
    status: "pending",
    createdAt: "2026-04-16T10:00:00Z",
    startedAt: null,
    completedAt: null,
    answer: null,
    error: null,
  }

  await store.writeTelegramJob(job)
  await expect(store.readTelegramJob(job.id)).resolves.toEqual({
    ...job,
    sequence: undefined,
    telegramDeliveredAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    backend: null,
    resultFormat: null,
  })
})

test("writes and reads session state", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-state-store-"))
  tempDirs.push(root)
  const store = createStateStore(root)

  const session: SessionState = {
    runtimeVersion: "v1",
    activeSessionName: "theo-pi",
    activeWorkspacePath: "/tmp/workspace",
    piPid: 456,
    supervisorPid: 789,
    daemonStatus: "running",
    restartCount: 2,
    lastStartedAt: "2026-04-16T10:00:00Z",
    lastRestartedAt: "2026-04-16T10:05:00Z",
  }

  await store.writeSessionState(session)
  await expect(store.readSessionState("theo-pi")).resolves.toEqual(session)
})
