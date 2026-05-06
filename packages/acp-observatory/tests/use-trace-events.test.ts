import { expect, test } from "bun:test"

import { createTraceEventStore } from "../src/frontend/use-trace-events"
import type { CollectedTraceEvent } from "../src/shared/protocol"

const event: CollectedTraceEvent = {
  streamId: "source/run/agent",
  sourceId: "source",
  runId: "run",
  agentId: "agent",
  seq: 1,
  at: new Date(0).toISOString(),
  format: "acpx-runtime-event-v1",
  payload: { type: "text_delta", text: "hello" },
}

test("trace event store notifies subscribers on append", () => {
  const store = createTraceEventStore()
  let calls = 0
  const unsubscribe = store.subscribe(() => {
    calls += 1
  })

  store.append(event)
  unsubscribe()
  store.append({ ...event, seq: 2 })

  expect(calls).toBe(1)
  expect(store.getSnapshot().map((entry) => entry.seq)).toEqual([1, 2])
})

test("trace event store replaces snapshots", () => {
  const store = createTraceEventStore([event])
  let calls = 0
  store.subscribe(() => {
    calls += 1
  })

  store.replace([{ ...event, seq: 7 }])

  expect(calls).toBe(1)
  expect(store.getSnapshot().map((entry) => entry.seq)).toEqual([7])
})
