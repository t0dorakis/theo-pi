import * as acp from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"

import { acpPromptText, mapGatewayEventToSessionUpdate, stopReasonFromJob } from "./acp-event-mapper"
import { createGatewayClient, type GatewayJobEventRecord } from "./acp-proxy-client"

type SessionState = {
  sessionId: string
  chatId: string
  activeJobId: string | null
  pendingAbort: AbortController | null
}

type TheoPiAcpAgentOptions = {
  gatewayUrl: string
  gatewayToken: string
  pollIntervalMs?: number
}

export class TheoPiAcpAgent {
  private readonly sessions = new Map<string, SessionState>()
  private readonly gateway: ReturnType<typeof createGatewayClient>
  private readonly pollIntervalMs: number

  constructor(private readonly connection: acp.AgentSideConnection, options: TheoPiAcpAgentOptions) {
    this.gateway = createGatewayClient({ url: options.gatewayUrl, token: options.gatewayToken })
    this.pollIntervalMs = options.pollIntervalMs ?? 500
    queueMicrotask(() => {
      this.connection.signal.addEventListener("abort", () => {
        for (const session of this.sessions.values()) {
          if (session.activeJobId) void this.gateway.cancel(session.activeJobId).catch(() => {})
        }
      })
    })
  }

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: params.protocolVersion ?? acp.PROTOCOL_VERSION,
      agentInfo: { name: "theo-pi", version: "0.1.0" },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {},
      },
      authMethods: [],
    } as acp.InitializeResponse
  }

  async authenticate(): Promise<Record<string, never>> {
    return {}
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const requested = params._meta && typeof params._meta === "object" ? (params._meta as Record<string, unknown>)["theoPi.chatId"] : undefined
    const fixed = process.env.PI_WORKER_ACP_FIXED_CHAT_ID
    const chatId = typeof requested === "string" && requested.trim()
      ? requested.trim()
      : fixed && fixed.trim()
        ? fixed.trim()
        : `acp-${randomUUID()}`
    if (/^\d+$/.test(chatId)) throw new Error("numeric chatId is reserved for Telegram jobs")
    const sessionId = chatId
    this.sessions.set(sessionId, { sessionId, chatId, activeJobId: null, pendingAbort: null })
    return { sessionId, _meta: { "theoPi.chatId": chatId } } as acp.NewSessionResponse
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) throw new Error(`session not found: ${params.sessionId}`)
    if (session.activeJobId) throw new Error(`session busy: ${params.sessionId}`)

    const prompt = acpPromptText(params.prompt)
    if (!prompt) throw new Error("empty prompt")

    const abort = new AbortController()
    session.pendingAbort = abort
    let emittedText = false

    try {
      const submitted = await this.gateway.run(session.chatId, prompt)
      session.activeJobId = submitted.id
      let lastSeq = 0

      while (!abort.signal.aborted) {
        const events = await this.gateway.events(submitted.id, lastSeq).catch(() => [] as GatewayJobEventRecord[])
        for (const record of events) {
          lastSeq = Math.max(lastSeq, record.seq)
          const update = mapGatewayEventToSessionUpdate(params.sessionId, record.event)
          if (update) {
            if ((update.update as Record<string, unknown>).sessionUpdate === "agent_message_chunk") emittedText = true
            await this.connection.sessionUpdate(update as acp.SessionNotification)
          }
        }

        const job = await this.gateway.job(submitted.id)
        if (job.status === "done" || job.status === "failed") {
          const terminalText = job.status === "failed"
            ? `${emittedText ? "\n\n" : ""}Worker job failed: ${job.error ?? "unknown error"}`
            : job.answer
          if ((job.status === "failed" || !emittedText) && terminalText) {
            await this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: terminalText } },
            } as acp.SessionNotification)
          }
          return { stopReason: stopReasonFromJob(job), userMessageId: params.messageId ?? undefined } as acp.PromptResponse
        }
        await sleep(this.pollIntervalMs)
      }

      await this.gateway.cancel(submitted.id).catch(() => {})
      return { stopReason: "cancelled", userMessageId: params.messageId ?? undefined } as acp.PromptResponse
    } finally {
      session.activeJobId = null
      session.pendingAbort = null
    }
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId)
    session?.pendingAbort?.abort()
    if (session?.activeJobId) await this.gateway.cancel(session.activeJobId).catch(() => {})
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
