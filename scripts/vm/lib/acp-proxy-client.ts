import type { WorkerJob } from "./types"

export type GatewayJobEventRecord = {
  seq: number
  at: string
  jobId: string
  attempt: string
  event: unknown
}

export type GatewayClientOptions = {
  url: string
  token: string
  fetchImpl?: typeof fetch
}

export function createGatewayClient(options: GatewayClientOptions) {
  const base = options.url.replace(/\/$/, "")
  const doFetch = options.fetchImpl ?? fetch

  async function request(path: string, init: RequestInit = {}) {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    const json = text ? JSON.parse(text) as Record<string, unknown> : {}
    if (!response.ok || json.ok === false) {
      throw new Error(typeof json.error === "string" ? json.error : `gateway ${response.status}`)
    }
    return json
  }

  return {
    async run(chatId: string, prompt: string) {
      const payload = await request("/run", { method: "POST", body: JSON.stringify({ chatId, prompt }) })
      return { id: String(payload.id), chatId: String(payload.chatId) }
    },

    async job(id: string) {
      const payload = await request(`/jobs/${encodeURIComponent(id)}`)
      return payload.job as WorkerJob
    },

    async events(id: string, after = 0) {
      const payload = await request(`/jobs/${encodeURIComponent(id)}/events?after=${after}`)
      return payload.events as GatewayJobEventRecord[]
    },

    async cancel(id: string) {
      await request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" })
    },
  }
}
