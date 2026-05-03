import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResultChannel } from "../result-channel"
import type { WorkerJob } from "../types"
import { createAcpxBackend } from "./acpx-backend"

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: "job-acpx-001",
    chatId: "42",
    prompt: "say hi",
    status: "running",
    createdAt: "2026-04-21T10:00:00Z",
    startedAt: "2026-04-21T10:00:01Z",
    completedAt: null,
    answer: null,
    error: null,
    backend: "acpx",
    ...overrides,
  }
}

test("acpx backend writes done result after successful exec", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))
  const calls: Array<{ command: string; args: string[] }> = []

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async (command, args = []) => {
      calls.push({ command, args })
      return "Hello from Pi"
    },
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  // Verify the acpx command shape
  expect(calls.length).toBe(1)
  expect(calls[0].command).toBe("acpx")
  expect(calls[0].args).toContain("pi")
  expect(calls[0].args).toContain("exec")
  expect(calls[0].args).toContain("--format")
  expect(calls[0].args).toContain("quiet")
  expect(calls[0].args).toContain("--approve-all")
  expect(calls[0].args).toContain("say hi")
  // No XML wrapper — raw prompt passed directly
  expect(calls[0].args.join(" ")).not.toContain("final_answer")

  // readResult returns the answer
  const result = await backend.readResult(job)
  expect(result).toBe("Hello from Pi")
})

test("acpx backend passes --cwd when configured", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))
  const calls: Array<{ command: string; args: string[] }> = []

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    cwd: "/repo/myapp",
    runLocal: async (command, args = []) => {
      calls.push({ command, args })
      return "done"
    },
  })

  await backend.submitPrompt(makeJob())

  expect(calls[0].args).toContain("--cwd")
  expect(calls[0].args).toContain("/repo/myapp")
})

test("acpx backend uses custom acpxCommand when provided", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))
  const calls: Array<{ command: string; args: string[] }> = []

  const backend = createAcpxBackend({
    stateDir,
    agent: "codex",
    acpxCommand: "/usr/local/bin/acpx",
    runLocal: async (command, args = []) => {
      calls.push({ command, args })
      return "Codex done"
    },
  })

  await backend.submitPrompt(makeJob())

  expect(calls[0].command).toBe("/usr/local/bin/acpx")
  expect(calls[0].args).toContain("codex")
})

test("acpx backend writes failed result on exec error", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async () => {
      throw new Error("acpx: command not found")
    },
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  // readResult throws on failure — callers must distinguish pending (null) from error (throw)
  await expect(backend.readResult(job)).rejects.toThrow("acpx exec failed")

  // Confirm the result file records failure
  const channel = createResultChannel(stateDir)
  const stored = await channel.readResult(job.id)
  expect(stored.status).toBe("failed")
  expect(stored.error).toContain("acpx exec failed")
})

test("acpx backend sessionHealth returns ok when acpx --version succeeds", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async (_cmd, args = []) => {
      if (args[0] === "--version") return "acpx 0.3.2"
      return ""
    },
  })

  const health = await backend.sessionHealth()
  expect(health.ok).toBe(true)
})

test("acpx backend sessionHealth returns not-ok when acpx missing", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async () => {
      throw new Error("ENOENT: acpx not found")
    },
  })

  const health = await backend.sessionHealth()
  expect(health.ok).toBe(false)
  expect(health.detail).toContain("acpx not found")
})

test("acpx backend readResult returns null when result file is absent", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async () => "",
  })

  // No submitPrompt called — result file does not exist
  const result = await backend.readResult(makeJob())
  expect(result).toBeNull()
})

test("acpx backend submit times out and writes failed result", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    timeoutMs: 10, // 10ms — will time out immediately
    runLocal: async () => new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
  })

  const job = makeJob({ id: "job-timeout" })
  await backend.submitPrompt(job)

  await expect(backend.readResult(job)).rejects.toThrow("timed out")
})

test("acpx backend cancel is a no-op and does not throw", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "acpx-backend-"))

  const backend = createAcpxBackend({
    stateDir,
    agent: "pi",
    runLocal: async () => "",
  })

  await expect(backend.cancel("job-acpx-001")).resolves.toBeUndefined()
})
