import { afterEach, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { WorkerEnv } from "./env"
import { createJobQueue } from "./jobs"
import { requestCancelJob, requestCancelJobsForChat, runQueuedJob } from "./worker-runner"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

function makeEnv(stateDir: string, sessionMode: "oneshot" | "persistent" = "persistent"): WorkerEnv {
  return {
    acpx: {
      agent: "pi",
      agentCommand: undefined,
      sessionMode,
      cwd: undefined,
      stateDir: join(stateDir, "acp"),
      timeoutMs: 5_000,
      sessionTtlHours: 24,
    },
    homeDir: stateDir,
    stateDir,
    workerName: "test",
    gatewayHost: "127.0.0.1",
    gatewayPort: 8787,
    gatewayToken: "",
    gatewayDrain: true,
    telegramWebhookSecret: "",
    telegramBotToken: "",
    telegramAllowedChatIds: new Set(),
    telegramPollTimeoutSeconds: 30,
    telegramLogLines: 20,
    telegramTypingIntervalMs: 4000,
    jobTimeoutSeconds: 5,
    jobPollIntervalMs: 1000,
    jobCaptureLines: 500,
  }
}

function makeMockModule(delayMs = 25) {
  const ensureSession = mock(async (input: { sessionKey: string; mode: string }) => ({
    sessionKey: input.sessionKey,
    backend: "mock",
    runtimeSessionName: "mock-session",
  }))
  const startTurn = mock((input: { text: string }) => {
    async function* events() {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      yield { type: "text_delta" as const, text: input.text.replace(/^answer:/, "") }
    }
    return {
      requestId: "req",
      events: events(),
      result: Promise.resolve({ status: "completed" as const }),
      cancel: mock(async () => {}),
      closeStream: mock(async () => {}),
    }
  })

  return {
    runtime: { ensureSession, startTurn, doctor: mock(async () => ({ ok: true, message: "ok" })) },
    module: {
      AcpxRuntime: class {
        constructor() {
          return { ensureSession, startTurn, doctor: mock(async () => ({ ok: true, message: "ok" })) }
        }
      },
      createAgentRegistry: () => ({ resolve: (n: string) => n, list: () => [] }),
      createFileSessionStore: () => ({}),
      AcpRuntimeError: class extends Error {
        code: string
        constructor(code: string, message: string) {
          super(message)
          this.code = code
          this.name = "AcpRuntimeError"
        }
      },
    },
  }
}

test("persistent jobs for same chat serialize by turn lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "worker-runner-lock-"))
  tempDirs.push(root)
  const env = makeEnv(root, "persistent")
  const queue = createJobQueue(root, { backend: "acpx" })
  const first = await queue.enqueueJob({ chatId: "chat-1", prompt: "answer:first" })
  const second = await queue.enqueueJob({ chatId: "chat-1", prompt: "answer:second" })
  const mockRuntime = makeMockModule()
  mock.module("acpx/runtime", () => mockRuntime.module)

  const results = await Promise.all([runQueuedJob(first.id, env), runQueuedJob(second.id, env)])

  expect(results.map((result) => result.status)).toEqual(["done", "done"])
  expect(await queue.getJob(first.id)).toMatchObject({ status: "done", answer: "first" })
  expect(await queue.getJob(second.id)).toMatchObject({ status: "done", answer: "second" })
  const eventLog = await readFile(join(root, "jobs", "events", `${first.id}.ndjson`), "utf8")
  expect(eventLog).toContain('"type":"text_delta"')
})

test("cancel marker before claim prevents acpx turn from starting", async () => {
  const root = await mkdtemp(join(tmpdir(), "worker-runner-cancel-"))
  tempDirs.push(root)
  const env = makeEnv(root, "persistent")
  const queue = createJobQueue(root, { backend: "acpx" })
  const job = await queue.enqueueJob({ chatId: "chat-1", prompt: "answer:never" })
  const mockRuntime = makeMockModule()
  mock.module("acpx/runtime", () => mockRuntime.module)

  await requestCancelJob(job.id, "test cancel", env)
  const result = await runQueuedJob(job.id, env)

  expect(result).toMatchObject({ status: "failed", error: "job canceled before start" })
  expect(mockRuntime.runtime.startTurn).toHaveBeenCalledTimes(0)
  expect(await queue.getJob(job.id)).toMatchObject({ status: "failed", error: "job canceled before start" })
})

test("reset cancellation includes pending jobs for chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "worker-runner-reset-"))
  tempDirs.push(root)
  const env = makeEnv(root, "persistent")
  const queue = createJobQueue(root, { backend: "acpx" })
  const pending = await queue.enqueueJob({ chatId: "chat-1", prompt: "answer:pending" })
  await queue.enqueueJob({ chatId: "chat-2", prompt: "answer:other" })
  const mockRuntime = makeMockModule()
  mock.module("acpx/runtime", () => mockRuntime.module)

  const canceled = await requestCancelJobsForChat("chat-1", env)
  const result = await runQueuedJob(pending.id, env)

  expect(canceled).toEqual([pending.id])
  expect(result).toMatchObject({ status: "failed", error: "job canceled before start" })
})
