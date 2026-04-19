import { expect, test } from "bun:test"

import type { WorkerJob } from "../types"
import { createTmuxBackend, extractAnswerFromPane, formatDelegatedPrompt, markerPair } from "./tmux-backend"

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
  expect(prompt).toContain("Respond with exactly one XML element and nothing else")
  expect(prompt).toContain("Reply with exactly: pong")
  expect(prompt).toContain("<final_answer")
  expect(prompt.includes("\n")).toBe(false)
  expect(prompt.match(/<final_answer/g)?.length).toBe(1)
  expect(prompt.match(/<\/final_answer>/g)?.length).toBe(1)
})

test("tmux backend extracts answer from final_answer xml block", () => {
  const { startMarker, endMarker } = markerPair("job-1234567890")
  const pane = `noise\n${startMarker}\npong\n${endMarker}\n`
  expect(extractAnswerFromPane(pane, "job-1234567890")).toBe("pong")
})

test("tmux backend session health surfaces executor result", async () => {
  const backend = createTmuxBackend({
    session: "theo-pi",
    runLocal: async () => "ok",
  })

  await expect(backend.sessionHealth()).resolves.toEqual({ ok: true })
})
