import { expect, test } from "bun:test"
import { Effect } from "effect"

import { makeTraceCollector } from "../src/backend/collector"
import type { CollectedTraceEvent } from "../src/shared/protocol"

function event(seq: number): CollectedTraceEvent {
  return {
    streamId: "source/run/agent",
    sourceId: "source",
    runId: "run",
    agentId: "agent",
    seq,
    at: new Date(seq).toISOString(),
    format: "acpx-runtime-event-v1",
    payload: { type: "text_delta", text: `event ${seq}` },
  }
}

test("snapshot returns a defensive event copy", async () => {
  const program = Effect.gen(function* () {
    const collector = yield* makeTraceCollector()
    yield* collector.ingest(event(1))
    const first = yield* collector.snapshot("source/run/agent")
    ;(first.events as CollectedTraceEvent[]).push(event(999))
    const second = yield* collector.snapshot("source/run/agent")
    return second.events.map((entry) => entry.seq)
  })

  await expect(Effect.runPromise(program)).resolves.toEqual([1])
})

test("collector retains only configured max events per stream", async () => {
  const program = Effect.gen(function* () {
    const collector = yield* makeTraceCollector({ maxEventsPerStream: 3 })
    yield* collector.ingest(event(1))
    yield* collector.ingest(event(2))
    yield* collector.ingest(event(3))
    yield* collector.ingest(event(4))
    const snapshot = yield* collector.snapshot("source/run/agent")
    return snapshot.events.map((entry) => entry.seq)
  })

  await expect(Effect.runPromise(program)).resolves.toEqual([2, 3, 4])
})

test("snapshot supports afterSeq and limit windows", async () => {
  const program = Effect.gen(function* () {
    const collector = yield* makeTraceCollector()
    yield* collector.ingest(event(1))
    yield* collector.ingest(event(2))
    yield* collector.ingest(event(3))
    yield* collector.ingest(event(4))
    const snapshot = yield* collector.snapshot("source/run/agent", { afterSeq: 1, limit: 2 })
    return snapshot.events.map((entry) => entry.seq)
  })

  await expect(Effect.runPromise(program)).resolves.toEqual([2, 3])
})
