#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

import { apiThrottler } from "@grammyjs/transformer-throttler"
import { Api } from "grammy"

import { getWorkerEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"
import { createTelegramRunner } from "./lib/telegram-runner"

const execFileAsync = promisify(execFile)
const env = getWorkerEnv()
const scriptDir = getScriptDir(import.meta.url)
const queue = createJobQueue(env.stateDir, { backend: "acpx" })
const telegramQueue = {
  reapExpiredLeases: queue.reapExpiredLeases,
  async claimNextJob() {
    const jobs = await queue.listJobs()
    return jobs.find((job) => job.status === "pending" && !job.telegramDeliveredAt && /^-?\d+$/.test(job.chatId)) ?? null
  },
  completeJob: queue.completeJob,
  failJob: queue.failJob,
  markDelivered: queue.markDelivered,
}

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

const api = new Api(env.telegramBotToken)
api.config.use(apiThrottler())
const telegram = {
  sendMessage: async (chatId: number, text: string) => {
    let remaining = text
    do {
      const chunk = remaining.slice(0, 4000) || " "
      remaining = remaining.slice(4000)
      await api.sendMessage(chatId, chunk, { link_preview_options: { is_disabled: true } })
    } while (remaining.length > 0)
  },
  sendChatAction: async (chatId: number, action: string) => {
    await api.sendChatAction(chatId, action as "typing")
  },
}

const runner = createTelegramRunner({
  queue: telegramQueue,
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
  leaseOwner: `telegram-runner-${env.workerName}`,
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
