import { expect, test } from "bun:test"

import { startObservatoryServer } from "../src/backend/http-server"
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

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  const decoder = new TextDecoder()
  let buffer = ""
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    const result = await reader.read()
    if (result.done) break
    buffer += decoder.decode(result.value, { stream: true })
    if (buffer.includes(needle)) return buffer
  }
  throw new Error(`did not receive ${needle}; got ${buffer}`)
}

test("server ingests events and returns stream snapshot", async () => {
  const server = await startObservatoryServer({ port: 0, staticDir: "/tmp/does-not-exist" })
  try {
    const ingest = await fetch(`${server.url}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    })
    expect(ingest.ok).toBe(true)

    const snapshot = await fetch(`${server.url}/api/streams/${encodeURIComponent(event.streamId)}/snapshot`).then((response) => response.json()) as { eventCount: number; events: CollectedTraceEvent[] }
    expect(snapshot.eventCount).toBe(1)
    expect(snapshot.events[0].seq).toBe(1)
  } finally {
    server.stop()
  }
})

test("server keeps SSE subscription live for ingested events", async () => {
  const server = await startObservatoryServer({ port: 0, staticDir: "/tmp/does-not-exist" })
  try {
    const response = await fetch(`${server.url}/api/streams/${encodeURIComponent(event.streamId)}/events`)
    expect(response.ok).toBe(true)
    const reader = response.body!.getReader()
    try {
      await readUntil(reader, "event: snapshot")
      const ingest = await fetch(`${server.url}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      })
      expect(ingest.ok).toBe(true)
      const chunk = await readUntil(reader, "event: event")
      expect(chunk).toContain("hello")
    } finally {
      await reader.cancel().catch(() => {})
    }
  } finally {
    server.stop()
  }
})
