import { Schema } from "effect"

export const TraceFormat = Schema.Literal(
  "acp-session-update-v1",
  "acp-jsonrpc-session-update-v1",
  "acpx-runtime-event-v1",
  "pi-worker-prompt-v1",
  "pi-worker-session-ready-v1",
  "pi-worker-session-error-v1",
  "pi-worker-turn-result-v1",
  "pi-worker-turn-exception-v1",
  "pi-worker-retry-error-v1",
  "unknown-json-v1",
)

export const CollectedTraceEvent = Schema.Struct({
  streamId: Schema.String,
  sourceId: Schema.String,
  runId: Schema.String,
  agentId: Schema.optional(Schema.String),
  seq: Schema.Number,
  at: Schema.String,
  format: TraceFormat,
  payload: Schema.Unknown,
})

export type CollectedTraceEvent = typeof CollectedTraceEvent.Type

export const StreamIdentity = Schema.Struct({
  streamId: Schema.String,
  sourceId: Schema.String,
  runId: Schema.String,
  agentId: Schema.optional(Schema.String),
})

export type StreamIdentity = typeof StreamIdentity.Type

export const StreamSnapshot = Schema.Struct({
  identity: StreamIdentity,
  updatedAt: Schema.String,
  eventCount: Schema.Number,
  events: Schema.Array(CollectedTraceEvent),
})

export type StreamSnapshot = typeof StreamSnapshot.Type

export const StreamSummary = Schema.Struct({
  identity: StreamIdentity,
  updatedAt: Schema.String,
  eventCount: Schema.Number,
})

export type StreamSummary = typeof StreamSummary.Type
