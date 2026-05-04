import { appendFile, mkdir } from "node:fs/promises"
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
    const seq = (counters.get(jobId) ?? 0) + 1
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
