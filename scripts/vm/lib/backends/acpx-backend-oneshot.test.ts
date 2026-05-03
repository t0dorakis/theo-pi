import { expect, test, mock } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResultChannel } from "../result-channel"
import type { WorkerJob } from "../types"

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockTurnEvents = Array<{ type: "text_delta"; text: string; stream?: string }>

function makeMockTurn(opts: {
  events?: MockTurnEvents
  result?: import("acpx/runtime").AcpRuntimeTurnResult
  cancelMock?: ReturnType<typeof mock>
}) {
  const events = opts.events ?? []
  const result = opts.result ?? { status: "completed" as const }
  const cancel = opts.cancelMock ?? mock(async () => {})

  async function* makeEvents() {
    for (const e of events) yield e
  }

  return {
    requestId: "req",
    events: makeEvents(),
    result: Promise.resolve(result),
    cancel,
    closeStream: mock(async () => {}),
  }
}

function makeMockRuntime(opts: {
  ensureSessionImpl?: () => Promise<{ sessionKey: string; backend: string; runtimeSessionName: string }>
  startTurnImpl?: (input: unknown) => ReturnType<typeof makeMockTurn>
}) {
  const ensureSession = mock(
    opts.ensureSessionImpl ??
      (async (input: { sessionKey: string; mode: string }) => ({
        sessionKey: input.sessionKey,
        backend: "mock",
        runtimeSessionName: "mock-session",
      })),
  )

  const startTurn = mock(
    opts.startTurnImpl ??
      ((_input: unknown) =>
        makeMockTurn({
          events: [{ type: "text_delta", text: "hello from pi" }],
          result: { status: "completed" },
        })),
  )

  const doctor = mock(async () => ({ ok: true, message: "all good" }))

  return {
    ensureSession,
    startTurn,
    doctor,
    runTurn: mock(async function* () {}),
    cancel: mock(async () => {}),
    close: mock(async () => {}),
  }
}

function makeMockModule(runtime: ReturnType<typeof makeMockRuntime>) {
  return {
    AcpxRuntime: class {
      constructor() {
        Object.assign(this, runtime)
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
  }
}

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    chatId: "42",
    prompt: "say hi",
    status: "running",
    createdAt: "2026-04-21T10:00:00Z",
    startedAt: "2026-04-21T10:00:01Z",
    completedAt: null,
    answer: null,
    error: null,
    backend: "acpx-runtime",
    ...overrides,
  }
}

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "acpx-runtime-backend-"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("submitPrompt writes done result with answer text", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    startTurnImpl: (_: unknown) =>
      makeMockTurn({
        events: [
          { type: "text_delta", text: "Hello " },
          { type: "text_delta", text: "from Pi" },
        ],
        result: { status: "completed" },
      }),
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  const result = await backend.readResult(job)
  expect(result).toBe("Hello from Pi")
})

test("submitPrompt uses oneshot mode with jobId as sessionKey", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({})

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob({ id: "job-abc-123" })
  await backend.submitPrompt(job)

  expect(runtime.ensureSession).toHaveBeenCalledTimes(1)
  const call = runtime.ensureSession.mock.calls[0][0] as { sessionKey: string; mode: string }
  expect(call.sessionKey).toBe("job-abc-123")
  expect(call.mode).toBe("oneshot")
})

test("submitPrompt writes failed result when turn fails", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    startTurnImpl: (_: unknown) =>
      makeMockTurn({
        result: { status: "failed", error: { message: "oops", code: "ACP_TURN_FAILED" } },
      }),
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  await expect(backend.readResult(job)).rejects.toThrow()

  const channel = createResultChannel(stateDir)
  const stored = await channel.readResult(job.id)
  expect(stored.status).toBe("failed")
  expect(stored.error).toContain("ACP_TURN_FAILED")
})

test("submitPrompt writes failed result when turn is cancelled", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    startTurnImpl: (_: unknown) =>
      makeMockTurn({
        result: { status: "cancelled", stopReason: "worker cancel" },
      }),
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  await expect(backend.readResult(job)).rejects.toThrow("worker cancel")
})

test("thought stream deltas are excluded from answer", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    startTurnImpl: (_: unknown) =>
      makeMockTurn({
        events: [
          { type: "text_delta", text: "thinking...", stream: "thought" },
          { type: "text_delta", text: "actual answer" },
        ],
        result: { status: "completed" },
      }),
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  await backend.submitPrompt(job)

  const result = await backend.readResult(job)
  expect(result).toBe("actual answer")
  expect(result).not.toContain("thinking")
})

test("readResult returns null when result file absent", async () => {
  const stateDir = await makeTmpDir()

  mock.module("acpx/runtime", () => makeMockModule(makeMockRuntime({})))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  // No submitPrompt — file absent
  const result = await backend.readResult(job)
  expect(result).toBeNull()
})

test("cancel calls turn cancel fn", async () => {
  const stateDir = await makeTmpDir()

  const cancelMock = mock(async () => {})
  const neverResolve = new Promise<import("acpx/runtime").AcpRuntimeTurnResult>(() => {})

  const runtime = makeMockRuntime({
    startTurnImpl: (_: unknown) => ({
      requestId: "r",
      events: (async function* () {})(),
      result: neverResolve,
      cancel: cancelMock,
      closeStream: mock(async () => {}),
    }),
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  const job = makeJob()
  const submitPromise = backend.submitPrompt(job)

  await new Promise<void>((r) => setTimeout(r, 10))

  await backend.cancel(job.id)
  expect(cancelMock).toHaveBeenCalledTimes(1)

  submitPromise.catch(() => {})
})

test("sessionHealth returns ok from runtime.doctor()", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({})

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxBackend } = await import("./acpx-backend")
  const backend = createAcpxBackend({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "oneshot" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
  })

  // Trigger lazy runtime init.
  await backend.submitPrompt(makeJob())

  const health = await backend.sessionHealth()
  expect(health.ok).toBe(true)
  expect(health.detail).toBe("all good")
})
