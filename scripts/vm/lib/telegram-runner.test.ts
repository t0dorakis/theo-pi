import { expect, test } from "bun:test"

import type { WorkerJob } from "./types"
import { createTelegramRunner } from "./telegram-runner"

const baseJob: WorkerJob = {
  id: "job-1",
  chatId: "123",
  prompt: "hi",
  status: "pending",
  createdAt: "2026-04-20T10:00:00Z",
  startedAt: null,
  completedAt: null,
  answer: null,
  error: null,
  backend: "smolvm",
}

test("runner sends done answer and marks delivered", async () => {
  const sent: string[] = []
  let delivered = false
  let completed = false
  const runner = createTelegramRunner({
    queue: {
      reapExpiredLeases: async () => 0,
      claimNextJob: async () => ({ ...baseJob, status: "running" }),
      completeJob: async () => {
        completed = true
      },
      failJob: async () => {},
      markDelivered: async () => {
        delivered = true
      },
    },
    jobs: { runJob: async () => ({ status: "done", answer: "pong" }) },
    telegram: {
      sendMessage: async (_chatId: number, text: string) => void sent.push(text),
      sendChatAction: async () => {},
    },
    sleep: async () => {},
    typingIntervalMs: 10,
  })

  const worked = await runner.runOnce()
  expect(worked).toBe(true)
  expect(sent).toEqual(["pong"])
  expect(completed).toBe(true)
  expect(delivered).toBe(true)
})

test("runner sends failed error and marks delivered", async () => {
  const sent: string[] = []
  let delivered = false
  let failed = false
  const runner = createTelegramRunner({
    queue: {
      reapExpiredLeases: async () => 0,
      claimNextJob: async () => ({ ...baseJob, status: "running" }),
      completeJob: async () => {},
      failJob: async () => {
        failed = true
      },
      markDelivered: async () => {
        delivered = true
      },
    },
    jobs: { runJob: async () => ({ status: "failed", error: "boom" }) },
    telegram: {
      sendMessage: async (_chatId: number, text: string) => void sent.push(text),
      sendChatAction: async () => {},
    },
    sleep: async () => {},
    typingIntervalMs: 10,
  })

  await runner.runOnce()
  expect(sent).toEqual(["Error: boom"])
  expect(failed).toBe(true)
  expect(delivered).toBe(true)
})

test("runner noops when no pending job", async () => {
  const runner = createTelegramRunner({
    queue: {
      reapExpiredLeases: async () => 1,
      claimNextJob: async () => null,
      completeJob: async () => undefined,
      failJob: async () => undefined,
      markDelivered: async () => undefined,
    },
    jobs: { runJob: async () => ({ status: "done", answer: "unused" }) },
    telegram: {
      sendMessage: async () => {},
      sendChatAction: async () => {},
    },
    sleep: async () => {},
    typingIntervalMs: 10,
  })

  await expect(runner.runOnce()).resolves.toBe(false)
})
