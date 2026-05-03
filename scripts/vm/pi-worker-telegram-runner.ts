#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

import { getRuntimeEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"
import { createTelegramApi } from "./lib/telegram-api"
import { createTelegramRunner } from "./lib/telegram-runner"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const scriptDir = getScriptDir(import.meta.url)
const queue = createJobQueue(env.stateDir, { backend: env.backend })

if (!env.telegramBotToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN")
  process.exit(1)
}

if (env.telegramAllowedChatIds.size === 0) {
  console.error("Missing TELEGRAM_ALLOWED_CHAT_IDS")
  process.exit(1)
}

await mkdir(`${env.stateDir}/telegram/jobs`, { recursive: true })

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  })
  return `${stdout}${stderr}`.trim()
}

const telegram = createTelegramApi({
  token: env.telegramBotToken,
  allowedChatIds: env.telegramAllowedChatIds,
})

const runner = createTelegramRunner({
  queue,
  jobs: {
    async runJob(jobId: string) {
      try {
        await runLocal(process.execPath, [localScript(scriptDir, "pi-worker-run-job.ts"), jobId])
      } catch (error) {
        console.error(`[telegram-runner] run-job failed for ${jobId}:`, error instanceof Error ? error.message : String(error))
        // rely on persisted job/result state below
      }
      const job = await queue.getJob(jobId)
      if (!job) return { status: "failed" as const, error: `job missing after run: ${jobId}` }
      return job.status === "done"
        ? { status: "done" as const, answer: job.answer }
        : { status: "failed" as const, error: job.error ?? "job failed" }
    },
  },
  telegram,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  typingIntervalMs: env.telegramTypingIntervalMs,
  leaseOwner: `telegram-runner-${env.session}`,
})

while (true) {
  const worked = await runner.runOnce().catch((error) => {
    console.error(error)
    return false
  })
  if (!worked) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}
