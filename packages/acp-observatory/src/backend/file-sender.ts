import { open, stat } from "node:fs/promises"

import type { CollectedTraceEvent } from "../shared/protocol"

function argValue(args: string[], flag: string) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

async function readRange(path: string, start: number, endExclusive: number) {
  const length = endExclusive - start
  if (length <= 0) return ""
  const file = await open(path, "r")
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString("utf8")
  } finally {
    await file.close()
  }
}

function splitLines(input: string) {
  const parts = input.replaceAll("\r\n", "\n").split("\n")
  const rest = parts.pop() ?? ""
  return { lines: parts.filter((line) => line.trim().length > 0), rest }
}

function parseSourceLine(input: {
  line: string
  fallbackSeq: number
  sourceId: string
  runId: string
  agentId?: string
}): CollectedTraceEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.line)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  const format = typeof record.format === "string" ? record.format : "unknown-json-v1"
  const seq = typeof record.seq === "number" && Number.isFinite(record.seq) ? record.seq : input.fallbackSeq
  const payload = Object.hasOwn(record, "payload") ? record.payload : Object.hasOwn(record, "event") ? record.event : record
  return {
    streamId: `${input.sourceId}/${input.runId}/${input.agentId ?? "agent"}`,
    sourceId: input.sourceId,
    runId: input.runId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    seq,
    at: typeof record.at === "string" ? record.at : new Date().toISOString(),
    format: format as CollectedTraceEvent["format"],
    payload,
  }
}

async function postEvents(endpoint: string, events: CollectedTraceEvent[]) {
  if (events.length === 0) return
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(events),
  })
  if (!response.ok) throw new Error(`ingest failed ${response.status}: ${await response.text()}`)
}

export async function streamFileToCollector(input: {
  file: string
  to: string
  sourceId: string
  runId: string
  agentId?: string
  intervalMs?: number
  replayExisting?: boolean
  signal?: AbortSignal
}) {
  let offset = 0
  let rest = ""
  let fallbackSeq = 1
  const intervalMs = input.intervalMs ?? 500

  async function readAvailable() {
    const size = (await stat(input.file)).size
    if (size < offset) {
      offset = 0
      rest = ""
    }
    if (size === offset) return
    const chunk = await readRange(input.file, offset, size)
    offset = size
    const split = splitLines(`${rest}${chunk}`)
    rest = split.rest
    const events = split.lines.flatMap((line) => {
      const event = parseSourceLine({ line, fallbackSeq, sourceId: input.sourceId, runId: input.runId, agentId: input.agentId })
      if (!event) return []
      fallbackSeq = Math.max(fallbackSeq + 1, event.seq + 1)
      return [event]
    })
    await postEvents(input.to, events)
  }

  if (input.replayExisting !== false) await readAvailable()
  else offset = (await stat(input.file)).size

  while (!input.signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    await readAvailable()
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const file = argValue(args, "--file")
  const to = argValue(args, "--to")
  const sourceId = argValue(args, "--source") ?? "local"
  const runId = argValue(args, "--run") ?? file?.split("/").at(-1)?.replace(/\.ndjson$/, "") ?? "run"
  const agentId = argValue(args, "--agent") ?? "agent"
  if (!file || !to) {
    console.error("usage: file-sender --file <events.ndjson> --to <collector/api/ingest> [--source id] [--run id] [--agent id]")
    process.exit(2)
  }
  console.log(`streaming ${file} -> ${to} as ${sourceId}/${runId}/${agentId}`)
  await streamFileToCollector({ file, to, sourceId, runId, agentId })
}
