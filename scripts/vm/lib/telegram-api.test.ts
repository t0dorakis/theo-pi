import { expect, test } from "bun:test"

import { createTelegramApi } from "./telegram-api"

test("telegram api chunks long messages", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = []
  const api = createTelegramApi({
    token: "token",
    allowedChatIds: new Set(["123"]),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      calls.push({ method: String((_url as string).split("/").pop()), body })
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    },
  })

  await api.sendMessage(123, "x".repeat(4500))

  expect(calls).toHaveLength(2)
  expect(String(calls[0].body.text).length).toBe(4000)
  expect(String(calls[1].body.text).length).toBe(500)
})

test("telegram allowlist accepts wildcard", () => {
  const api = createTelegramApi({
    token: "token",
    allowedChatIds: new Set(["*"]),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
  })

  expect(() => api.assertAllowed(456)).not.toThrow()
})

test("telegram api surfaces method failure", async () => {
  const api = createTelegramApi({
    token: "token",
    allowedChatIds: new Set(["123"]),
    fetchImpl: async () => new Response("bad gateway", { status: 502 }),
  })

  await expect(api.sendChatAction(123, "typing")).rejects.toThrow("Telegram API sendChatAction failed: 502 bad gateway")
})
