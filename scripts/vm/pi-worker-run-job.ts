#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createBackend } from "./lib/backend-registry"
import { getRuntimeEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"
import { createResultChannel } from "./lib/result-channel"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const queue = createJobQueue(env.stateDir, { backend: env.backend })
const scriptDir = getScriptDir(import.meta.url)
const session = env.session
const timeoutSeconds = env.jobTimeoutSeconds
const pollIntervalMs = env.jobPollIntervalMs
const captureLines = env.jobCaptureLines
const resultChannel = createResultChannel(env.stateDir)

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  })
  return `${stdout}${stderr}`.trim()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const backend = createBackend({
  env,
  runLocal,
  delegateScript: localScript(scriptDir, "pi-worker-delegate"),
})

const jobId = process.argv[2]
if (!jobId) {
  console.error("usage: pi-worker-run-job <jobId>")
  process.exit(1)
}

const existing = await queue.getJob(jobId)
if (!existing) {
  console.error(`job not found: ${jobId}`)
  process.exit(1)
}

const job = existing.status === "running" ? existing : await queue.claimJob(jobId, `runner-${session}`)
if (!job) {
  console.error(`job not claimable: ${jobId}`)
  process.exit(1)
}

await resultChannel.writeRequest({
  id: job.id,
  backendId: job.backend ?? "tmux",
  prompt: job.prompt,
  acceptedAt: new Date().toISOString(),
  leaseOwner: job.leaseOwner ?? null,
  leaseExpiresAt: job.leaseExpiresAt ?? null,
})

await backend.submitPrompt(job)

const deadline = Date.now() + timeoutSeconds * 1000
while (Date.now() < deadline) {
  await queue.heartbeatLease(job.id)
  try {
    const answer = await backend.readResult(job)
    if (answer) {
      await queue.completeJob(job.id, answer)
      console.log(JSON.stringify({ ok: true, id: job.id, resultPath: resultChannel.resultPath(job.id) }))
      process.exit(0)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await queue.failJob(job.id, message)
    console.error(message)
    process.exit(1)
  }
  await sleep(pollIntervalMs)
}

const error = `missing or malformed <final_answer> block after ${timeoutSeconds}s`
await resultChannel.writeResult({
  id: job.id,
  backendId: job.backend ?? "tmux",
  status: "failed",
  error,
  completedAt: new Date().toISOString(),
})
await queue.failJob(job.id, error)
console.error(error)
process.exit(1)
