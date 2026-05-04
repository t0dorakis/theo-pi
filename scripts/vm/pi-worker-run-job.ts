#!/usr/bin/env bun
import { runQueuedJob } from "./lib/worker-runner"

const jobId = process.argv[2]
if (!jobId) {
  console.error("usage: pi-worker-run-job <jobId>")
  process.exit(1)
}

const result = await runQueuedJob(jobId)
if (result.status === "done") {
  console.log(JSON.stringify({ ok: true, id: result.jobId, resultPath: result.resultPath }))
  process.exit(0)
}

console.error(result.error)
process.exit(1)
