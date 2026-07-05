#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { promisify } from "node:util"

import { getWorkerEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"
import { getRuntimePaths, getScriptDir, localScript } from "./lib/paths"
import { createStateStore } from "./lib/state-store"
import { getAcpxRuntimeHealth, requestCancelJob, requestCancelJobsForChat, resetWorkerChatSession } from "./lib/worker-runner"

const execFileAsync = promisify(execFile)
const env = getWorkerEnv()
const scriptDir = getScriptDir(import.meta.url)
const stateStore = createStateStore(env.stateDir)
const queue = createJobQueue(env.stateDir, { backend: "acpx" })

const workerName = env.workerName
const host = env.gatewayHost
const port = env.gatewayPort
const bearerToken = env.gatewayToken
const telegramWebhookSecret = env.telegramWebhookSecret
const telegramToken = env.telegramBotToken
const telegramAllowedChats = env.telegramAllowedChatIds
const logsLines = env.telegramLogLines
const runtimePaths = getRuntimePaths(env.stateDir, import.meta.url)
const runnerLogPath = `${env.stateDir}/jobs/runner.log`
let queueWorkerActive = false

type JsonRecord = Record<string, unknown>
type TelegramMessage = {
  chat?: { id?: number }
  text?: string
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  })
}

function text(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init.headers ?? {}),
    },
  })
}

function isAuthorized(request: Request) {
  const header = request.headers.get("authorization") ?? ""
  return header === `Bearer ${bearerToken}`
}

function webhookAuthorized(request: Request) {
  if (!telegramWebhookSecret) return false
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? ""
  return header === telegramWebhookSecret
}

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  })
  return `${stdout}${stderr}`.trim()
}

async function appendRunnerLog(jobId: string, message: string) {
  await mkdir(`${env.stateDir}/jobs`, { recursive: true })
  await appendFile(runnerLogPath, `[${new Date().toISOString()}] [${jobId}] ${message}\n`).catch(() => {})
}

function safeJobIdFromPath(value: string) {
  const jobId = decodeURIComponent(value)
  if (!/^[A-Za-z0-9._:-]+$/.test(jobId)) return null
  return jobId
}

async function runJobProcess(jobId: string) {
  try {
    const { stdout, stderr } = await execFileAsync(localScript(scriptDir, "pi-worker-run-job"), [jobId], {
      env: process.env,
      maxBuffer: 1024 * 1024 * 4,
    })
    const output = `${stdout}${stderr}`.trim()
    if (output) await appendRunnerLog(jobId, output)
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string; code?: number | string }
    await appendRunnerLog(
      jobId,
      `runner failed${detail.code != null ? ` code=${String(detail.code)}` : ""}: ${detail.message}\n${detail.stdout ?? ""}${detail.stderr ?? ""}`.trim(),
    )
  }
}

async function drainQueue() {
  if (queueWorkerActive) return
  queueWorkerActive = true
  try {
    while (true) {
      await queue.reapExpiredLeases()
      const jobs = await queue.listJobs()
      const nextPending = jobs.find((job) => job.status === "pending" && !job.telegramDeliveredAt && !/^-?\d+$/.test(job.chatId))
      if (!nextPending) break
      await runJobProcess(nextPending.id)
    }
  } finally {
    queueWorkerActive = false
  }
}

async function statusJson() {
  const stored = await stateStore.readHealth()
  if (stored) {
    return stored as JsonRecord
  }
  const output = await runLocal(localScript(scriptDir, "pi-worker-status"), [workerName, "--json"])
  return JSON.parse(output) as JsonRecord
}

async function enqueuePrompt(chatId: string, prompt: string) {
  const job = await queue.enqueueJob({ chatId, prompt })
  if (env.gatewayDrain) void drainQueue()
  return job
}

async function telegramApi(method: string, body: JsonRecord) {
  if (!telegramToken) {
    throw new Error("Telegram not configured")
  }
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/${method}`, {
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

async function telegramSendMessage(chatId: number, message: string) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
  })
}

function telegramAllowed(chatId: number) {
  return telegramAllowedChats.size > 0 && telegramAllowedChats.has(String(chatId))
}

async function handleTelegramCommand(message: TelegramMessage) {
  const chatId = message.chat?.id
  const textValue = (message.text ?? "").trim()

  if (!chatId || !textValue) {
    return { ok: true, ignored: true }
  }

  if (!telegramAllowed(chatId)) {
    return { ok: true, ignored: true }
  }

  if (textValue === "/help" || textValue === "/start") {
    await telegramSendMessage(
      chatId,
      ["Pi worker gateway commands:", "/run <prompt>", "/reset", "/status", "/restart", "/logs", "/checkpoint [label]"].join("\n"),
    )
    return { ok: true }
  }

  if (textValue === "/status") {
    await telegramSendMessage(chatId, JSON.stringify(await statusJson(), null, 2))
    return { ok: true }
  }

  if (textValue === "/restart") {
    const output = await runLocal(localScript(scriptDir, "pi-worker-restart"), [workerName])
    await telegramSendMessage(chatId, output)
    return { ok: true }
  }

  if (textValue === "/logs") {
    const output = await runLocal(localScript(scriptDir, "pi-worker-tail-logs"), [String(logsLines)])
    await telegramSendMessage(chatId, output || "(no logs)")
    return { ok: true }
  }

  if (textValue.startsWith("/checkpoint")) {
    const label = textValue.replace(/^\/checkpoint\s*/, "").trim() || "telegram"
    const output = await runLocal(localScript(scriptDir, "pi-worker-checkpoint"), [label])
    await telegramSendMessage(chatId, output)
    return { ok: true }
  }

  if (textValue === "/reset") {
    const cancelled = await requestCancelJobsForChat(String(chatId), env)
    const { gitSync } = await resetWorkerChatSession(String(chatId), env)
    const suffix = cancelled.length > 0 ? `; cancel requested for ${cancelled.length} running job(s)` : ""
    await telegramSendMessage(chatId, `reset persistent acpx session${suffix}; workspace git sync ${gitSync.status}: ${gitSync.detail}`)
    return { ok: true }
  }

  if (textValue.startsWith("/run ")) {
    const prompt = textValue.slice(5).trim()
    if (!prompt) {
      await telegramSendMessage(chatId, "usage: /run <prompt>")
      return { ok: true }
    }
    const job = await enqueuePrompt(String(chatId), prompt)
    await telegramSendMessage(chatId, `queued job ${job.id}`)
    return { ok: true }
  }

  await telegramSendMessage(chatId, "Unknown command. Use /help")
  return { ok: true }
}

if (!bearerToken) {
  console.error("Missing PI_WORKER_GATEWAY_TOKEN")
  process.exit(1)
}

if (env.gatewayDrain) void drainQueue()

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === "/telegram/webhook") {
      if (!webhookAuthorized(request)) {
        return text("unauthorized", { status: 401 })
      }
    } else if (url.pathname !== "/health" && !isAuthorized(request)) {
      return text("unauthorized", { status: 401 })
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const status = await statusJson()
        const acpx = await getAcpxRuntimeHealth(env)
        return json({ ...status, acpx })
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return json(await statusJson())
      }

      if (request.method === "POST" && url.pathname === "/run") {
        const body = (await request.json()) as JsonRecord
        const prompt = String(body.prompt ?? "").trim()
        const requestedChatId = String(body.chatId ?? "").trim()
        if (/^-?\d+$/.test(requestedChatId)) {
          return json({ ok: false, error: "numeric chatId is reserved for Telegram jobs" }, { status: 400 })
        }
        const chatId = requestedChatId || `gateway-${randomUUID()}`
        if (!prompt) {
          return json({ ok: false, error: "missing prompt" }, { status: 400 })
        }
        const job = await enqueuePrompt(chatId, prompt)
        return json({ ok: true, status: "queued", id: job.id, chatId: job.chatId })
      }

      const eventsMatch = url.pathname.match(/^\/jobs\/([^/]+)\/events$/)
      if (request.method === "GET" && eventsMatch) {
        const jobId = safeJobIdFromPath(eventsMatch[1])
        if (!jobId) return json({ ok: false, error: "invalid job id" }, { status: 400 })
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10)
        const content = await readFile(`${runtimePaths.jobEventsDir}/${jobId}.ndjson`, "utf8").catch(() => "")
        const events = content.split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { seq?: number })
          .filter((record) => typeof record.seq === "number" && record.seq > after)
        return json({ ok: true, jobId, events })
      }

      const cancelMatch = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/)
      if (request.method === "POST" && cancelMatch) {
        const jobId = safeJobIdFromPath(cancelMatch[1])
        if (!jobId) return json({ ok: false, error: "invalid job id" }, { status: 400 })
        const job = await queue.getJob(jobId)
        if (!job) return json({ ok: false, error: "job not found" }, { status: 404 })
        await requestCancelJob(jobId, "gateway cancel", env)
        return json({ ok: true, status: "cancel_requested", id: jobId })
      }

      if (request.method === "GET" && url.pathname.startsWith("/jobs/")) {
        const jobId = safeJobIdFromPath(url.pathname.slice("/jobs/".length))
        if (!jobId) return json({ ok: false, error: "invalid job id" }, { status: 400 })
        const job = await queue.getJob(jobId)
        if (!job) {
          return json({ ok: false, error: "job not found" }, { status: 404 })
        }
        return json({ ok: true, job })
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        const body = ((await request.json().catch(() => ({}))) ?? {}) as JsonRecord
        const chatId = String(body.chatId ?? "").trim()
        if (!chatId) {
          return json({ ok: false, error: "missing chatId" }, { status: 400 })
        }
        const cancelled = await requestCancelJobsForChat(chatId, env)
        const { gitSync } = await resetWorkerChatSession(chatId, env)
        return json({ ok: true, status: "reset", chatId, cancelled, gitSync })
      }

      if (request.method === "POST" && url.pathname === "/restart") {
        const output = await runLocal(localScript(scriptDir, "pi-worker-restart"), [workerName])
        return json({ ok: true, workerName, message: output })
      }

      if (request.method === "POST" && url.pathname === "/checkpoint") {
        const body = ((await request.json().catch(() => ({}))) ?? {}) as JsonRecord
        const label = String(body.label ?? "gateway").trim() || "gateway"
        const output = await runLocal(localScript(scriptDir, "pi-worker-checkpoint"), [label])
        return json({ ok: true, checkpoint: output })
      }

      if (request.method === "GET" && url.pathname === "/logs") {
        const output = await runLocal(localScript(scriptDir, "pi-worker-tail-logs"), [String(logsLines)])
        return text(output || "")
      }

      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        const body = (await request.json()) as { message?: TelegramMessage }
        if (body.message) {
          await handleTelegramCommand(body.message)
        }
        return json({ ok: true })
      }

      return text("not found", { status: 404 })
    } catch (error) {
      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      )
    }
  },
})

console.log(`Pi worker gateway listening on http://${host}:${server.port}`)
