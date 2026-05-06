import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startObservatoryServer } from "../src/backend/http-server"
import { streamFileToCollector } from "../src/backend/file-sender"

test("file sender replays ndjson into collector", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-observatory-sender-"))
  const file = join(root, "events.ndjson")
  const server = await startObservatoryServer({ port: 0, staticDir: "/tmp/does-not-exist" })
  const controller = new AbortController()
  try {
    await writeFile(file, `${JSON.stringify({ seq: 1, format: "acpx-runtime-event-v1", payload: { type: "text_delta", text: "hello" } })}\n`, "utf8")
    setTimeout(() => controller.abort(), 20)
    await streamFileToCollector({ file, to: `${server.url}/api/ingest`, sourceId: "source", runId: "run", agentId: "agent", signal: controller.signal })
    const snapshot = await fetch(`${server.url}/api/streams/${encodeURIComponent("source/run/agent")}/snapshot`).then((response) => response.json()) as { eventCount: number }
    expect(snapshot.eventCount).toBe(1)
  } finally {
    controller.abort()
    server.stop()
    await rm(root, { recursive: true, force: true })
  }
})
