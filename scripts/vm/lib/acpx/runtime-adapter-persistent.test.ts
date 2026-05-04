import { expect, test, mock, beforeEach } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResultChannel } from "../result-channel"
import type { WorkerJob } from "../types"

// ---------------------------------------------------------------------------
// Mock acpx/runtime
// ---------------------------------------------------------------------------

type MockTurnEvents = Array<{ type: "text_delta"; text: string; stream?: string }>

type TurnSpec = {
  events?: MockTurnEvents
  result?: import("acpx/runtime").AcpRuntimeTurnResult
}

function makeMockRuntime(opts: {
  turns?: TurnSpec[]
  ensureSessionImpl?: (input: { sessionKey: string; mode: string }) => Promise<{ sessionKey: string; backend: string; runtimeSessionName: string }>
}) {
  let turnIndex = 0
  const turns = opts.turns ?? []

  const ensureSession = mock(
    opts.ensureSessionImpl ??
      (async (input: { sessionKey: string; mode: string }) => ({
        sessionKey: input.sessionKey,
        backend: "mock",
        runtimeSessionName: "mock-session",
      })),
  )

  const startTurn = mock((_input: unknown) => {
    const spec = turns[turnIndex++] ?? { events: [], result: { status: "completed" as const } }
    const events = spec.events ?? []
    const result = spec.result ?? { status: "completed" as const }

    async function* makeEvents() {
      for (const e of events) yield e
    }

    return {
      requestId: "req",
      events: makeEvents(),
      result: Promise.resolve(result),
      cancel: mock(async () => {}),
      closeStream: mock(async () => {}),
    }
  })

  const doctor = mock(async () => ({ ok: true, message: "healthy" }))
  const close = mock(async () => {})

  const runtime = {
    ensureSession,
    startTurn,
    doctor,
    runTurn: mock(async function* () {}),
    cancel: mock(async () => {}),
    close,
  }

  return runtime
}

// We mock `acpx/runtime` by intercepting the dynamic import inside the module.
// Strategy: use Bun's module mock so the runtime adapter sees our fake.

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    chatId: "99999",
    prompt: "hello",
    status: "running",
    createdAt: "2026-04-21T10:00:00Z",
    startedAt: "2026-04-21T10:00:01Z",
    completedAt: null,
    answer: null,
    error: null,
    backend: "acpx-persistent",
    ...overrides,
  }
}

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "acpx-persistent-"))
}

// ---------------------------------------------------------------------------
// Test: session key is <agent>-<chatId>
// ---------------------------------------------------------------------------

test("session key is <agent>-<chatId>", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    turns: [{ events: [{ type: "text_delta", text: "hi" }], result: { status: "completed" } }],
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  const job = makeJob({ chatId: "123456789" })
  await adapter.submitPrompt(job)

  expect(runtime.ensureSession).toHaveBeenCalledTimes(1)
  const call = runtime.ensureSession.mock.calls[0][0] as { sessionKey: string; mode: string }
  expect(call.sessionKey).toBe("pi-123456789")
  expect(call.mode).toBe("persistent")
})

// ---------------------------------------------------------------------------
// Test: second job for same chatId reuses cached handle
// ---------------------------------------------------------------------------

test("second job for same chatId reuses cached handle (ensureSession called once)", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    turns: [
      { events: [{ type: "text_delta", text: "first" }], result: { status: "completed" } },
      { events: [{ type: "text_delta", text: "second" }], result: { status: "completed" } },
    ],
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  const job1 = makeJob({ chatId: "777" })
  const job2 = makeJob({ chatId: "777" })

  await adapter.submitPrompt(job1)
  await adapter.submitPrompt(job2)

  // ensureSession called exactly once — second job reuses handle from cache
  expect(runtime.ensureSession).toHaveBeenCalledTimes(1)
  expect(runtime.startTurn).toHaveBeenCalledTimes(2)
})

// ---------------------------------------------------------------------------
// Test: on session error, handle evicted and session recreated
// ---------------------------------------------------------------------------

test("on session error, handle evicted from cache and session recreated", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({
    // First turn fails with a session error; second turn (retry) succeeds.
    turns: [
      {
        events: [],
        result: {
          status: "failed",
          error: { message: "session not found", code: "ACP_SESSION_INIT_FAILED" },
        },
      },
      { events: [{ type: "text_delta", text: "retry ok" }], result: { status: "completed" } },
    ],
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  const job = makeJob({ chatId: "888" })
  await adapter.submitPrompt(job)

  // ensureSession called twice: once for first attempt, once for retry
  expect(runtime.ensureSession).toHaveBeenCalledTimes(2)
  // startTurn called twice: original + retry
  expect(runtime.startTurn).toHaveBeenCalledTimes(2)

  // Final result should be "done" from the retry
  const result = await adapter.readResult(job)
  expect(result).toBe("retry ok")
})

// ---------------------------------------------------------------------------
// Test: sessionHealth returns ok when doctor returns healthy
// ---------------------------------------------------------------------------

test("sessionHealth returns ok from runtime.doctor()", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({ turns: [] })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  // Trigger runtime creation.
  const job = makeJob()
  runtime.startTurn = mock((_: unknown) => {
    async function* empty() {}
    return {
      requestId: "r",
      events: empty(),
      result: Promise.resolve({ status: "completed" as const }),
      cancel: mock(async () => {}),
      closeStream: mock(async () => {}),
    }
  })
  await adapter.submitPrompt(job)

  const health = await adapter.sessionHealth()
  expect(health.ok).toBe(true)
  expect(health.detail).toBe("healthy")
})

// ---------------------------------------------------------------------------
// Test: cancel calls turn.cancel and clears activeTurns
// ---------------------------------------------------------------------------

test("resetChatSession closes and discards persistent state", async () => {
  const stateDir = await makeTmpDir()

  const runtime = makeMockRuntime({})
  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  await adapter.resetChatSession("123")

  expect(runtime.ensureSession).toHaveBeenCalledTimes(1)
  expect(runtime.close).toHaveBeenCalledTimes(1)
  const closeArg = (runtime.close as any).mock.calls[0][0] as { discardPersistentState?: boolean; reason?: string }
  expect(closeArg.discardPersistentState).toBe(true)
  expect(closeArg.reason).toBe("worker reset")
})

test("cancel calls the stored cancel fn for in-flight turn", async () => {
  const stateDir = await makeTmpDir()

  let capturedCancel: (() => Promise<void>) | null = null

  // A turn that never resolves on its own (we cancel it)
  const neverResolve = new Promise<import("acpx/runtime").AcpRuntimeTurnResult>(() => {})

  const cancelMock = mock(async () => {})

  const runtime = makeMockRuntime({})
  runtime.startTurn = mock((_: unknown) => {
    async function* empty() {}
    return {
      requestId: "r",
      events: empty(),
      result: neverResolve,
      cancel: cancelMock,
      closeStream: mock(async () => {}),
    }
  })

  mock.module("acpx/runtime", () => makeMockModule(runtime))

  const { createAcpxRuntimeAdapter } = await import("./runtime-adapter")
  const adapter = createAcpxRuntimeAdapter({
    stateDir,
    acpxStateDir: stateDir,
    sessionMode: "persistent" as const,
    agent: "pi",
    cwd: undefined,
    timeoutMs: 5000,
    sessionTtlHours: 24,
  })

  const job = makeJob()

  // Start the turn but don't await — it hangs.
  const submitPromise = adapter.submitPrompt(job)

  // Give the event loop a tick to set activeTurns.
  await new Promise<void>((r) => setTimeout(r, 10))

  await adapter.cancel(job.id)

  expect(cancelMock).toHaveBeenCalledTimes(1)

  // Detach the dangling promise (we don't care about its result).
  submitPromise.catch(() => {})
})
