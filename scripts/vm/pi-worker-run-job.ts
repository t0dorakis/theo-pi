#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { getRuntimeEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const queue = createJobQueue(env.stateDir)
const scriptDir = getScriptDir(import.meta.url)
const session = env.session
const timeoutSeconds = env.jobTimeoutSeconds
const pollIntervalMs = env.jobPollIntervalMs
const captureLines = env.jobCaptureLines

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

function extractAnswer(pane: string, startMarker: string, endMarker: string) {
  const start = pane.lastIndexOf(startMarker)
  if (start === -1) return null
  const afterStart = pane.slice(start + startMarker.length)
  const end = afterStart.indexOf(endMarker)
  if (end === -1) return null
  return afterStart.slice(0, end).replace(/^[\s]+|[\s]+$/g, "")
}

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

const markerId = job.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)
const startMarker = `<<${markerId}>>`
const endMarker = `<</${markerId}>>`
const wrappedPrompt = `For machine parsing, reply in one message with exact format ${startMarker} your-answer ${endMarker}. No code fences. No extra commentary outside markers. User request: ${job.prompt}`

await runLocal(localScript(scriptDir, "pi-worker-delegate"), [session, wrappedPrompt])

const deadline = Date.now() + timeoutSeconds * 1000
while (Date.now() < deadline) {
  await queue.heartbeatLease(job.id)
  const pane = await runLocal("tmux", ["capture-pane", "-J", "-pt", `${session}:0`, "-S", `-${captureLines}`]).catch(() => "")
  const answer = extractAnswer(pane, startMarker, endMarker)
  if (answer) {
    await queue.completeJob(job.id, answer)
    console.log(JSON.stringify({ ok: true, id: job.id }))
    process.exit(0)
  }
  await sleep(pollIntervalMs)
}

const error = `timeout waiting for answer markers after ${timeoutSeconds}s`
await queue.failJob(job.id, error)
console.error(error)
process.exit(1)
