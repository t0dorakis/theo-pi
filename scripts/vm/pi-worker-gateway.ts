#!/usr/bin/env bun
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createTmuxBackend } from "./lib/backends/tmux-backend"
import { getRuntimeEnv } from "./lib/env"
import { getScriptDir, localScript } from "./lib/paths"
import { createStateStore } from "./lib/state-store"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const scriptDir = getScriptDir(import.meta.url)
const stateStore = createStateStore(env.stateDir)

const session = env.session
const host = env.gatewayHost
const port = env.gatewayPort
const bearerToken = env.gatewayToken
const telegramToken = env.telegramBotToken
const telegramAllowedChats = env.telegramAllowedChatIds
const logsLines = env.telegramLogLines
const backend = createTmuxBackend({
  session,
  delegateScript: localScript(scriptDir, "pi-worker-delegate"),
  runLocal,
})

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
  if (!bearerToken) return true
  const header = request.headers.get("authorization") ?? ""
  return header === `Bearer ${bearerToken}`
}

async function runLocal(command: string, args: string[] = []) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  })
  return `${stdout}${stderr}`.trim()
}

async function statusJson() {
  const stored = await stateStore.readHealth()
  if (stored) {
    return stored as JsonRecord
  }
  const output = await runLocal(localScript(scriptDir, "pi-worker-status"), [session, "--json"])
  return JSON.parse(output) as JsonRecord
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
      ["Pi worker gateway commands:", "/run <prompt>", "/status", "/restart", "/logs", "/checkpoint [label]"].join("\n"),
    )
    return { ok: true }
  }

  if (textValue === "/status") {
    await telegramSendMessage(chatId, JSON.stringify(await statusJson(), null, 2))
    return { ok: true }
  }

  if (textValue === "/restart") {
    const output = await runLocal(localScript(scriptDir, "pi-worker-restart"), [session])
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

  if (textValue.startsWith("/run ")) {
    const prompt = textValue.slice(5).trim()
    if (!prompt) {
      await telegramSendMessage(chatId, "usage: /run <prompt>")
      return { ok: true }
    }
    const output = await runLocal(localScript(scriptDir, "pi-worker-delegate"), [session, prompt])
    await telegramSendMessage(chatId, `${output}\n\nPrompt queued for ${session}.`)
    return { ok: true }
  }

  await telegramSendMessage(chatId, "Unknown command. Use /help")
  return { ok: true }
}

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname !== "/health" && url.pathname !== "/telegram/webhook" && !isAuthorized(request)) {
      return text("unauthorized", { status: 401 })
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const status = await statusJson()
        const backendHealth = await backend.sessionHealth()
        return json({ ...status, backend: backendHealth })
      }

      if (request.method === "GET" && url.pathname === "/status") {
        return json(await statusJson())
      }

      if (request.method === "POST" && url.pathname === "/run") {
        const body = (await request.json()) as JsonRecord
        const prompt = String(body.prompt ?? "").trim()
        if (!prompt) {
          return json({ ok: false, error: "missing prompt" }, { status: 400 })
        }
        const output = await runLocal(localScript(scriptDir, "pi-worker-delegate"), [session, prompt])
        return json({ ok: true, session, message: output })
      }

      if (request.method === "POST" && url.pathname === "/restart") {
        const output = await runLocal(localScript(scriptDir, "pi-worker-restart"), [session])
        return json({ ok: true, session, message: output })
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
