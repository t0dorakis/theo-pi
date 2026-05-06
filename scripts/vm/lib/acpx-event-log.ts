import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { getRuntimePaths } from "./paths"

export type AcpxJobEventLogAttempt = "initial" | "retry" | "session"

export type AcpxJobEventLogRecord = {
  seq: number
  at: string
  jobId: string
  attempt: AcpxJobEventLogAttempt
  /** Legacy compatibility field. Prefer format + payload for new consumers. */
  event?: unknown
  /** Discriminator for protocol/base event payload shape. */
  format?: string
  /** Native ACP/ACPX/pi-worker payload for the given format. */
  payload?: unknown
}

export function createAcpxEventLog(stateDir: string) {
  const paths = getRuntimePaths(stateDir, import.meta.url)
  const counters = new Map<string, number>()

  function eventPath(jobId: string) {
    return join(paths.jobEventsDir, `${jobId}.ndjson`)
  }

  async function appendRecord(input: {
    jobId: string
    attempt: AcpxJobEventLogAttempt
    event?: unknown
    format?: string
    payload?: unknown
  }) {
    await mkdir(paths.jobEventsDir, { recursive: true })
    const previousSeq = counters.get(input.jobId) ?? await lastSeq(eventPath(input.jobId))
    const seq = previousSeq + 1
    counters.set(input.jobId, seq)
    const record: AcpxJobEventLogRecord = {
      seq,
      at: new Date().toISOString(),
      jobId: input.jobId,
      attempt: input.attempt,
      ...(Object.hasOwn(input, "event") ? { event: input.event } : {}),
      ...(input.format ? { format: input.format, payload: input.payload } : {}),
    }
    await appendFile(eventPath(input.jobId), `${JSON.stringify(record)}\n`, "utf8")
  }

  async function append(jobId: string, attempt: AcpxJobEventLogAttempt, event: unknown, options: { format?: string } = {}) {
    await appendRecord({
      jobId,
      attempt,
      event,
      ...(options.format ? { format: options.format, payload: event } : {}),
    })
  }

  async function appendPayload(jobId: string, attempt: AcpxJobEventLogAttempt, format: string, payload: unknown, options: { legacyEvent?: unknown } = {}) {
    await appendRecord({
      jobId,
      attempt,
      format,
      payload,
      ...(Object.hasOwn(options, "legacyEvent") ? { event: options.legacyEvent } : {}),
    })
  }

  return {
    eventPath,
    append,
    appendPayload,
  }
}

async function lastSeq(path: string) {
  const content = await readFile(path, "utf8").catch(() => "")
  const lines = content.trimEnd().split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    try {
      const record = JSON.parse(line) as { seq?: unknown }
      if (typeof record.seq === "number" && Number.isFinite(record.seq)) return record.seq
    } catch {
      continue
    }
  }
  return 0
}
