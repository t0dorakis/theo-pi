import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createJobQueue } from "./jobs"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test("claims oldest pending job FIFO", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-jobs-"))
  tempDirs.push(root)
  const queue = createJobQueue(root, { leaseDurationSeconds: 60 })

  const first = await queue.enqueueJob({ chatId: "1", prompt: "first" })
  const second = await queue.enqueueJob({ chatId: "1", prompt: "second" })

  const claimed = await queue.claimNextJob("runner-1")
  expect(claimed?.id).toBe(first.id)
  expect(claimed?.status).toBe("running")
  expect(second.status).toBe("pending")
})

test("marks job done and delivered", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-jobs-"))
  tempDirs.push(root)
  const queue = createJobQueue(root, { leaseDurationSeconds: 60 })

  const job = await queue.enqueueJob({ chatId: "1", prompt: "first" })
  await queue.claimNextJob("runner-1")
  await queue.completeJob(job.id, "pong")
  await queue.markDelivered(job.id)

  const stored = await queue.getJob(job.id)
  expect(stored).toMatchObject({ status: "done", answer: "pong" })
  expect(stored?.telegramDeliveredAt).toBeString()
})

test("reaps expired lease back to pending", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-jobs-"))
  tempDirs.push(root)
  const queue = createJobQueue(root, { leaseDurationSeconds: 1 })

  const job = await queue.enqueueJob({ chatId: "1", prompt: "first" })
  const claimed = await queue.claimNextJob("runner-1")
  expect(claimed?.id).toBe(job.id)

  await queue.heartbeatLease(job.id, "2026-04-16T10:00:00.000Z")
  await queue.reapExpiredLeases("2026-04-16T10:00:02.000Z")

  const stored = await queue.getJob(job.id)
  expect(stored).toMatchObject({ status: "pending", leaseOwner: null, leaseExpiresAt: null })
})
