type FetchImpl = typeof fetch

export function createTelegramApi(options: {
  token: string
  allowedChatIds: Set<string>
  fetchImpl?: FetchImpl
}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiBase = `https://api.telegram.org/bot${options.token}`

  function assertAllowed(chatId: number) {
    if (options.allowedChatIds.has("*")) return
    if (!options.allowedChatIds.has(String(chatId))) {
      throw new Error(`chat ${chatId} not allowed`)
    }
  }

  async function api(method: string, body: Record<string, unknown>) {
    const response = await fetchImpl(`${apiBase}/${method}`, {
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
    await api("sendChatAction", { chat_id: chatId, action })
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

  return {
    api,
    assertAllowed,
    sendChatAction,
    sendMessage,
  }
}
