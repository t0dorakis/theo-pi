import { expect, test } from "bun:test"

import type { WorkerJob } from "../types"
import { createTmuxBackend, formatDelegatedPrompt } from "./tmux-backend"

test("tmux backend formats delegated prompt request", () => {
  const job: WorkerJob = {
    id: "job-1234567890",
    chatId: "1",
    prompt: "Reply with exactly: pong",
    status: "pending",
    createdAt: "2026-04-16T10:00:00Z",
    startedAt: null,
    completedAt: null,
    answer: null,
    error: null,
  }

  const prompt = formatDelegatedPrompt(job)
  expect(prompt).toContain("For machine parsing")
  expect(prompt).toContain("Reply with exactly: pong")
  expect(prompt).toContain("<<")
})

test("tmux backend session health surfaces executor result", async () => {
  const backend = createTmuxBackend({
    session: "theo-pi",
    runLocal: async () => "ok",
  })

  await expect(backend.sessionHealth()).resolves.toEqual({ ok: true })
})
