#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

import { getRuntimeEnv } from "./lib/env"
import { getScriptDir, localScript } from "./lib/paths"
import { createStateStore } from "./lib/state-store"
import { nowIso } from "./lib/time"
import type { WorkerJob } from "./lib/types"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const scriptDir = getScriptDir(import.meta.url)
const stateStore = createStateStore(env.stateDir)

const token = env.telegramBotToken
const allowedChatIds = env.telegramAllowedChatIds
const session = env.session
const pollTimeoutSeconds = env.telegramPollTimeoutSeconds
const logsLines = env.telegramLogLines
const typingIntervalMs = env.telegramTypingIntervalMs

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

const apiBase = `https://api.telegram.org/bot${token}`
let offset = 0
let queueWorkerActive = false
const typingByChat = new Map<string, number>()

const helpText = [
  "Pi worker bot commands:",
  "plain text - run prompt and return final answer",
  "/run <prompt> - same as plain text",
  "/status - show worker health JSON",
  "/restart - restart supervised session",
  "/logs - tail supervisor logs",
  "/checkpoint [label] - create checkpoint metadata",
  "/help - show this help",
].join("\n")

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureDirs() {
  await mkdir(stateStore.paths.telegramJobsDir, { recursive: true })
}

async function api(method: string, body: Record<string, unknown>) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed: ${response.status} ${await response.text()}`)
  }

  const payload = (await response.json()) as { ok: boolean; result?: unknown }
  if (!payload.ok) {
    throw new Error(`Telegram API ${method} error: ${JSON.stringify(payload)}`)
  }
  return payload.result
}

async function sendChatAction(chatId: number, action: string) {
  await api("sendChatAction", {
    chat_id: chatId,
    action,
  })
}

async function sendMessage(chatId: number, textValue: string) {
  const chunks: string[] = []
  let remaining = textValue
  while (remaining.length > 4000) {
    chunks.push(remaining.slice(0, 4000))
    remaining = remaining.slice(4000)
  }
  chunks.push(remaining)

  for (const chunk of chunks) {
    await api("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    })
  }
}

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
  })
  return `${stdout}${stderr}`.trim()
}

function assertAllowed(chatId: number) {
  if (!allowedChatIds.has(String(chatId))) {
    throw new Error(`chat ${chatId} not allowed`)
  }
}

async function loadJobs() {
  const jobs = await stateStore.listTelegramJobs()
  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function saveJob(job: WorkerJob) {
  await stateStore.writeTelegramJob(job)
}

async function enqueuePrompt(chatId: number, prompt: string) {
  await runLocal(localScript(scriptDir, "pi-worker-submit-job"), [String(chatId), prompt])
}

async function maybeStartTyping(chatId: number) {
  const key = String(chatId)
  const last = typingByChat.get(key) ?? 0
  if (Date.now() - last < typingIntervalMs) return
  typingByChat.set(key, Date.now())
  await sendChatAction(chatId, "typing").catch(() => {})
}

async function handleMessage(message: TelegramMessage) {
  const chatId = message.chat?.id
  if (!chatId) return

  try {
    assertAllowed(chatId)
  } catch {
    return
  }

  const textValue = (message.text ?? "").trim()
  if (!textValue) return

  try {
    if (textValue === "/help" || textValue === "/start") {
      await sendMessage(chatId, helpText)
      return
    }

    if (textValue === "/status") {
      const stored = await stateStore.readHealth()
      const output = stored
        ? JSON.stringify(stored, null, 2)
        : await runLocal(localScript(scriptDir, "pi-worker-status"), [session, "--json"])
      await sendMessage(chatId, output)
      return
    }

    if (textValue === "/restart") {
      const output = await runLocal(localScript(scriptDir, "pi-worker-restart"), [session])
      await sendMessage(chatId, output)
      return
    }

    if (textValue === "/logs") {
      const output = await runLocal(localScript(scriptDir, "pi-worker-tail-logs"), [String(logsLines)])
      await sendMessage(chatId, output || "(no logs)")
      return
    }

    if (textValue.startsWith("/checkpoint")) {
      const label = textValue.replace(/^\/checkpoint\s*/, "").trim() || "telegram"
      const output = await runLocal(localScript(scriptDir, "pi-worker-checkpoint"), [label])
      await sendMessage(chatId, output)
      return
    }

    const prompt = textValue.startsWith("/run ") ? textValue.slice(5).trim() : textValue.startsWith("/") ? "" : textValue
    if (!prompt) {
      await sendMessage(chatId, `Unknown command.\n\n${helpText}`)
      return
    }

    await enqueuePrompt(chatId, prompt)
    await maybeStartTyping(chatId)
    void drainQueue()
  } catch (error) {
    await sendMessage(chatId, `Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function drainQueue() {
  if (queueWorkerActive) return
  queueWorkerActive = true

  try {
    while (true) {
      const jobs = await loadJobs()

      for (const job of jobs) {
        if (job.telegramDeliveredAt) continue
        if (job.status === "done" && job.answer) {
          await sendMessage(Number(job.chatId), job.answer)
          job.telegramDeliveredAt = nowIso()
          await saveJob(job)
        } else if (job.status === "failed") {
          await sendMessage(Number(job.chatId), `Error: ${job.error ?? "job failed"}`)
          job.telegramDeliveredAt = nowIso()
          await saveJob(job)
        }
      }

      const running = jobs.find((job) => job.status === "running")
      if (running) {
        await maybeStartTyping(Number(running.chatId))
        await sleep(1500)
        continue
      }

      const nextPending = jobs.find((job) => job.status === "pending")
      if (!nextPending) {
        break
      }

      await maybeStartTyping(Number(nextPending.chatId))
      await runLocal(localScript(scriptDir, "pi-worker-run-job"), [nextPending.id]).catch(() => "")
      await sleep(500)
    }
  } catch (error) {
    console.error(error)
  } finally {
    queueWorkerActive = false
  }
}

async function poll() {
  while (true) {
    try {
      const updates = (await api("getUpdates", {
        offset,
        timeout: pollTimeoutSeconds,
        allowed_updates: ["message"],
      })) as TelegramUpdate[]

      for (const update of updates) {
        offset = update.update_id + 1
        if (update.message) {
          await handleMessage(update.message)
        }
      }
    } catch (error) {
      console.error(error)
      await sleep(3000)
    }
  }
}

console.log(`Starting Telegram Pi worker bot for session ${session}`)
await ensureDirs()
void drainQueue()
await poll()
