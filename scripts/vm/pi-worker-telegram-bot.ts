#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

import { getRuntimeEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"
import { createStateStore } from "./lib/state-store"
import { createTelegramApi } from "./lib/telegram-api"
import { createTelegramPoller } from "./lib/telegram-poller"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const scriptDir = getScriptDir(import.meta.url)
const stateStore = createStateStore(env.stateDir)
const queue = createJobQueue(env.stateDir)

const token = env.telegramBotToken
const allowedChatIds = env.telegramAllowedChatIds
const session = env.session
const pollTimeoutSeconds = env.telegramPollTimeoutSeconds
const logsLines = env.telegramLogLines

type TelegramUpdate = { update_id: number; message?: TelegramMessage }
type TelegramMessage = { chat?: { id?: number }; text?: string }

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN")
  process.exit(1)
}

if (allowedChatIds.size === 0) {
  console.error("Missing TELEGRAM_ALLOWED_CHAT_IDS")
  process.exit(1)
}

let offset = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const helpText = [
  "Pi worker bot commands:",
  "plain text - queue prompt and return final answer",
  "/run <prompt> - same as plain text",
  "/status - show worker health JSON",
  "/restart - restart supervised session",
  "/logs - tail supervisor logs",
  "/checkpoint [label] - create checkpoint metadata",
  "/help - show this help",
].join("\n")

async function ensureDirs() {
  await mkdir(stateStore.paths.telegramJobsDir, { recursive: true })
}

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  })
  return `${stdout}${stderr}`.trim()
}

const telegram = createTelegramApi({
  token,
  allowedChatIds,
})

const poller = createTelegramPoller({
  queue,
  telegram,
  commands: {
    async status() {
      const stored = await stateStore.readHealth()
      return stored ? JSON.stringify(stored, null, 2) : await runLocal(localScript(scriptDir, "pi-worker-status"), [session, "--json"])
    },
    async restart() {
      return runLocal(localScript(scriptDir, "pi-worker-restart"), [session])
    },
    async logs() {
      return runLocal(localScript(scriptDir, "pi-worker-tail-logs"), [String(logsLines)])
    },
    async checkpoint(label: string) {
      return runLocal(localScript(scriptDir, "pi-worker-checkpoint"), [label])
    },
  },
  helpText,
})

async function poll() {
  while (true) {
    try {
      const updates = (await telegram.api("getUpdates", {
        offset,
        timeout: pollTimeoutSeconds,
        allowed_updates: ["message"],
      })) as TelegramUpdate[]

      for (const update of updates) {
        offset = update.update_id + 1
        if (update.message) {
          await poller.handleMessage(update.message)
        }
      }
    } catch (error) {
      console.error(error)
      await sleep(3000)
    }
  }
}

console.log(`Starting Telegram Pi worker bot poller for session ${session}`)
await ensureDirs()
await poll()
