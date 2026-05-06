import { Context, Effect, Layer, PubSub, Queue, Schema, Scope } from "effect"

import { CollectedTraceEvent, type StreamSnapshot, type StreamSummary } from "../shared/protocol"

export class TraceDecodeError extends Error {
  readonly _tag = "TraceDecodeError"
}

export type TraceCollectorOptions = {
  maxEventsPerStream?: number
  pubSubCapacity?: number
}

export type TraceCollector = {
  ingest: (input: unknown) => Effect.Effect<CollectedTraceEvent, TraceDecodeError>
  listStreams: () => Effect.Effect<StreamSummary[]>
  snapshot: (streamId: string, options?: { afterSeq?: number; limit?: number }) => Effect.Effect<StreamSnapshot>
  subscribe: () => Effect.Effect<Queue.Dequeue<CollectedTraceEvent>, never, Scope.Scope>
}

export class TraceCollectorService extends Context.Tag("TraceCollectorService")<TraceCollectorService, TraceCollector>() {}

function trimEvents(events: CollectedTraceEvent[], maxEvents: number) {
  if (events.length <= maxEvents) return events
  return events.slice(events.length - maxEvents)
}

function windowEvents(events: CollectedTraceEvent[], options: { afterSeq?: number; limit?: number } = {}) {
  const afterSeq = options.afterSeq ?? Number.NEGATIVE_INFINITY
  const filtered = events.filter((event) => event.seq > afterSeq)
  if (options.limit == null) return [...filtered]
  return filtered.slice(0, Math.max(0, options.limit))
}

export function makeTraceCollector(options: TraceCollectorOptions = {}) {
  return Effect.gen(function* () {
    const maxEventsPerStream = options.maxEventsPerStream ?? 10_000
    const eventsByStream = new Map<string, CollectedTraceEvent[]>()
    const hub = yield* PubSub.sliding<CollectedTraceEvent>(options.pubSubCapacity ?? 2048)
    const decode = Schema.decodeUnknown(CollectedTraceEvent)

    const ingest: TraceCollector["ingest"] = (input) => Effect.gen(function* () {
      const event = yield* decode(input).pipe(Effect.mapError((error) => new TraceDecodeError(String(error))))
      const events = trimEvents([...(eventsByStream.get(event.streamId) ?? []), event], maxEventsPerStream)
      eventsByStream.set(event.streamId, events)
      yield* PubSub.publish(hub, event)
      return event
    })

    function identityFor(streamId: string, events: CollectedTraceEvent[]) {
      const first = events[0]
      return {
        streamId,
        sourceId: first?.sourceId ?? "unknown",
        runId: first?.runId ?? "unknown",
        ...(first?.agentId ? { agentId: first.agentId } : {}),
      }
    }

    const listStreams: TraceCollector["listStreams"] = () => Effect.sync(() => [...eventsByStream.entries()].map(([streamId, events]) => ({
      identity: identityFor(streamId, events),
      updatedAt: events.at(-1)?.at ?? new Date(0).toISOString(),
      eventCount: events.length,
    })))

    const snapshot: TraceCollector["snapshot"] = (streamId, snapshotOptions) => Effect.sync(() => {
      const retainedEvents = eventsByStream.get(streamId) ?? []
      const events = windowEvents(retainedEvents, snapshotOptions)
      return {
        identity: identityFor(streamId, retainedEvents),
        updatedAt: new Date().toISOString(),
        eventCount: retainedEvents.length,
        events,
      }
    })

    const subscribe = () => PubSub.subscribe(hub)

    return { ingest, listStreams, snapshot, subscribe } satisfies TraceCollector
  })
}

export const TraceCollectorLive = (options: TraceCollectorOptions = {}) => Layer.scoped(
  TraceCollectorService,
  makeTraceCollector(options),
)
