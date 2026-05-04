import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { getRuntimePaths } from "./paths"

export type AcpxJobEventLogRecord = {
  seq: number
  at: string
  jobId: string
  attempt: "initial" | "retry" | "session"
  event: unknown
}

export function createAcpxEventLog(stateDir: string) {
  const paths = getRuntimePaths(stateDir, import.meta.url)
  const counters = new Map<string, number>()

  function eventPath(jobId: string) {
    return join(paths.jobEventsDir, `${jobId}.ndjson`)
  }

  async function append(jobId: string, attempt: AcpxJobEventLogRecord["attempt"], event: unknown) {
    await mkdir(paths.jobEventsDir, { recursive: true })
    const previousSeq = counters.get(jobId) ?? await lastSeq(eventPath(jobId))
    const seq = previousSeq + 1
    counters.set(jobId, seq)
    const record: AcpxJobEventLogRecord = {
      seq,
      at: new Date().toISOString(),
      jobId,
      attempt,
      event,
    }
    await appendFile(eventPath(jobId), `${JSON.stringify(record)}\n`, "utf8")
  }

  return {
    eventPath,
    append,
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
