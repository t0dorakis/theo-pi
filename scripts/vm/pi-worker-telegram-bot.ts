#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

import { apiThrottler } from "@grammyjs/transformer-throttler"
import { run } from "@grammyjs/runner"
import { Bot, GrammyError, HttpError, type Context } from "grammy"

import { getWorkerEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getScriptDir, localScript } from "./lib/paths"
import { createStateStore } from "./lib/state-store"
import { routeTelegramTextMessage } from "./lib/telegram-router"
import { requestCancelJobsForChat, resetWorkerChatSession } from "./lib/worker-runner"

const execFileAsync = promisify(execFile)
const env = getWorkerEnv()
const scriptDir = getScriptDir(import.meta.url)
const stateStore = createStateStore(env.stateDir)
const queue = createJobQueue(env.stateDir, { backend: "acpx" })

const token = env.telegramBotToken
const allowedChatIds = env.telegramAllowedChatIds
const workerName = env.workerName
const logsLines = env.telegramLogLines

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN")
  process.exit(1)
}

if (allowedChatIds.size === 0) {
  console.error("Missing TELEGRAM_ALLOWED_CHAT_IDS")
  process.exit(1)
}

function assertAllowed(chatId: number) {
  if (allowedChatIds.has("*")) return
  if (!allowedChatIds.has(String(chatId))) throw new Error(`chat ${chatId} not allowed`)
}

const botCommands = [
  { command: "start", description: "Show help" },
  { command: "help", description: "Show help" },
  { command: "run", description: "Queue a prompt" },
  { command: "status", description: "Show worker status" },
  { command: "reset", description: "Reset chat session" },
  { command: "restart", description: "Restart worker" },
  { command: "logs", description: "Show recent logs" },
  { command: "checkpoint", description: "Create checkpoint" },
]

const helpText = [
  "Pi worker bot commands:",
  "plain text - queue prompt and return final answer",
  "groups: mention @bot anywhere or reply to bot message",
  "/run <prompt> - same as plain text",
  "/status - show worker health JSON",
  "/reset - reset persistent acpx session for this chat",
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

async function status() {
  const stored = await stateStore.readHealth()
  return stored ? JSON.stringify(stored, null, 2) : await runLocal(localScript(scriptDir, "pi-worker-status"), [workerName, "--json"])
}

async function reset(chatId: number) {
  const cancelled = await requestCancelJobsForChat(String(chatId), env)
  const { gitSync } = await resetWorkerChatSession(String(chatId), env)
  const parts = ["reset persistent acpx session"]
  if (cancelled.length > 0) parts.push(`cancel requested for ${cancelled.length} queued/running job(s)`)
  parts.push(`workspace git sync ${gitSync.status}: ${gitSync.detail}`)
  return parts.join("; ")
}

async function replyChunked(ctx: Context, text: string) {
  let remaining = text || " "
  do {
    const chunk = remaining.slice(0, 4000) || " "
    remaining = remaining.slice(4000)
    await ctx.reply(chunk, { link_preview_options: { is_disabled: true } })
  } while (remaining.length > 0)
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 5) {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      console.error(`${label} failed attempt ${attempt}/${attempts}:`, error instanceof Error ? error.message : String(error))
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 10000)))
    }
  }
  throw lastError
}

function logBotError(error: unknown) {
  if (error instanceof GrammyError) {
    console.error(`Telegram request failed: ${error.description}`)
  } else if (error instanceof HttpError) {
    console.error(`Telegram network error: ${error.message}`)
  } else {
    console.error(error)
  }
}

const bot = new Bot(token)
bot.api.config.use(apiThrottler())
const me = await retry("Telegram getMe", () => bot.api.getMe())
const botUsername = me.username
if (!botUsername) {
  console.error("Telegram bot username missing from getMe")
  process.exit(1)
}
await bot.api.setMyCommands(botCommands).catch((error) => {
  console.error("Telegram setMyCommands failed; continuing without command menu:", error instanceof Error ? error.message : String(error))
})

bot.catch(({ error }) => logBotError(error))

bot.on("message:text", async (ctx) => {
  const chatId = ctx.message.chat.id
  try {
    assertAllowed(chatId)
  } catch {
    return
  }

  const route = routeTelegramTextMessage({
    message: ctx.message,
    botUsername,
    requireMentionInGroups: process.env.TELEGRAM_REQUIRE_MENTION_IN_GROUPS !== "0",
  })

  if (route.type === "ignore") return

  if (route.type === "prompt") {
    await queue.enqueueJob({ chatId: String(chatId), prompt: route.prompt })
    return
  }

  if (route.type === "reply") {
    await replyChunked(ctx, route.text)
    return
  }

  switch (route.command) {
    case "help":
    case "start":
      await replyChunked(ctx, helpText)
      return
    case "status":
      await replyChunked(ctx, await status())
      return
    case "reset":
      await replyChunked(ctx, await reset(chatId))
      return
    case "restart":
      await replyChunked(ctx, await runLocal(localScript(scriptDir, "pi-worker-restart"), [workerName]))
      return
    case "logs":
      await replyChunked(ctx, (await runLocal(localScript(scriptDir, "pi-worker-tail-logs"), [String(logsLines)])) || "(no logs)")
      return
    case "checkpoint":
      await replyChunked(ctx, await runLocal(localScript(scriptDir, "pi-worker-checkpoint"), [route.arg || "telegram"]))
      return
  }
})

console.log(`Starting Telegram Pi worker bot poller for worker ${workerName} (@${botUsername})`)
await ensureDirs()
const runner = run(bot)
const stop = () => void runner.stop()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
