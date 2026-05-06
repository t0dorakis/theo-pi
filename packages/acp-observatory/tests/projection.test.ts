import { expect, test } from "bun:test"

import type { CollectedTraceEvent } from "../src/shared/protocol"
import { projectTraceSteps } from "../src/shared/projection"

function event(seq: number, payload: unknown, format: CollectedTraceEvent["format"] = "acpx-runtime-event-v1"): CollectedTraceEvent {
  return {
    streamId: "source/run/agent",
    sourceId: "source",
    runId: "run",
    agentId: "agent",
    seq,
    at: new Date(seq).toISOString(),
    format,
    payload,
  }
}

test("projection coalesces token deltas and tool updates into visible steps", () => {
  const steps = projectTraceSteps([
    event(1, { sessionKey: "session" }, "pi-worker-session-ready-v1"),
    event(2, { type: "text_delta", stream: "thought", text: "thinking" }),
    event(3, { type: "tool_call", toolCallId: "tool-1", title: "bash", status: "pending" }),
    event(4, { type: "tool_call", toolCallId: "tool-1", title: "tool call", status: "in_progress" }),
    event(5, { type: "tool_call", toolCallId: "tool-1", title: "tool call", status: "completed" }),
    event(6, { type: "text_delta", stream: "output", text: "done" }),
    event(7, { status: "completed" }, "pi-worker-turn-result-v1"),
  ])

  expect(steps.map((step) => step.kind)).toEqual(["thought", "tool", "message"])
  expect(steps[0]).toMatchObject({ title: "thinking", status: "completed", rawEventCount: 1, startSeq: 2, endSeq: 2 })
  expect(steps[1]).toMatchObject({ title: "bash", status: "completed", rawEventCount: 3, startSeq: 3, endSeq: 5 })
  expect(steps[2]).toMatchObject({ title: "done", status: "completed", rawEventCount: 1, startSeq: 6, endSeq: 6 })
})

test("projection splits thought headings into separate reasoning steps", () => {
  const steps = projectTraceSteps([
    event(1, { type: "text_delta", stream: "thought", text: "**Assessing state**\nNeed context.\n\n" }),
    event(2, { type: "text_delta", stream: "thought", text: "**Planning fix**\nPatch projection." }),
    event(3, { type: "tool_call", toolCallId: "tool-1", title: "read", status: "completed" }),
  ])

  expect(steps.map((step) => step.kind)).toEqual(["thought", "thought", "tool"])
  expect(steps[0]).toMatchObject({ title: "Assessing state", rawEventCount: 1 })
  expect(steps[1]).toMatchObject({ title: "Planning fix", rawEventCount: 1 })
})

test("projection marks tail text as in progress", () => {
  const steps = projectTraceSteps([
    event(1, { type: "text_delta", stream: "thought", text: "Still thinking" }),
    event(2, { type: "text_delta", stream: "thought", text: " through it" }),
  ])

  expect(steps).toHaveLength(1)
  expect(steps[0]).toMatchObject({ kind: "thought", status: "in_progress", rawEventCount: 2 })
})

test("projection unwraps ACP thought and tool updates with parameters", () => {
  const steps = projectTraceSteps([
    event(1, { update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking." } } }, "acp-session-update-v1"),
    event(2, { update: { sessionUpdate: "tool_call", toolCallId: "read-1", title: "read", status: "running", input: { path: "packages/acp-observatory/src/shared/projection.ts" } } }, "acp-session-update-v1"),
    event(3, { update: { sessionUpdate: "tool_call_update", toolCallId: "read-1", title: "tool call", status: "success" } }, "acp-session-update-v1"),
  ])

  expect(steps.map((step) => step.kind)).toEqual(["thought", "tool"])
  expect(steps[1]).toMatchObject({ title: "read · projection.ts", toolName: "read", detail: "projection.ts", status: "completed" })
})

test("projection groups consecutive low-level tool bursts", () => {
  const steps = projectTraceSteps([
    event(1, { type: "tool_call", toolCallId: "read-1", title: "read", status: "completed", input: { path: "a.ts" } }),
    event(2, { type: "tool_call", toolCallId: "read-2", title: "read", status: "completed", input: { path: "b.ts" } }),
    event(3, { type: "tool_call", toolCallId: "read-3", title: "read", status: "completed", input: { path: "c.ts" } }),
    event(4, { type: "tool_call", toolCallId: "bash-1", title: "bash", status: "completed", input: { command: "bun test" } }),
  ])

  expect(steps).toHaveLength(2)
  expect(steps[0]).toMatchObject({ kind: "tool", title: "read ×3 · a.ts, b.ts, c.ts", groupedStepCount: 3, rawEventCount: 3 })
  expect(steps[1]).toMatchObject({ kind: "tool", title: "bash · bun test" })
})

test("projection marks failed tool as failed", () => {
  const steps = projectTraceSteps([
    event(1, { type: "tool_call", toolCallId: "tool-1", title: "read", status: "pending" }),
    event(2, { type: "tool_call", toolCallId: "tool-1", title: "tool call", status: "failed" }),
  ])

  expect(steps).toHaveLength(1)
  expect(steps[0]).toMatchObject({ kind: "tool", title: "read", status: "failed" })
})
