type TelegramMessage = { chat?: { id?: number }; text?: string }

export function createTelegramPoller(options: {
  queue: { enqueueJob(input: { chatId: string; prompt: string }): Promise<unknown> }
  telegram: { assertAllowed(chatId: number): void; sendMessage(chatId: number, text: string): Promise<void> }
  commands: {
    status(): Promise<string>
    restart(): Promise<string>
    logs(): Promise<string>
    checkpoint(label: string): Promise<string>
  }
  helpText: string
  onJobDelegation?: (jobId?: string) => Promise<void>
}) {
  async function handleMessage(message: TelegramMessage) {
    const chatId = message.chat?.id
    if (!chatId) return

    try {
      options.telegram.assertAllowed(chatId)
    } catch {
      return
    }

    const textValue = (message.text ?? "").trim()
    if (!textValue) return

    if (textValue === "/help" || textValue === "/start") {
      await options.telegram.sendMessage(chatId, options.helpText)
      return
    }

    if (textValue === "/status") {
      await options.telegram.sendMessage(chatId, await options.commands.status())
      return
    }

    if (textValue === "/restart") {
      await options.telegram.sendMessage(chatId, await options.commands.restart())
      return
    }

    if (textValue === "/logs") {
      await options.telegram.sendMessage(chatId, (await options.commands.logs()) || "(no logs)")
      return
    }

    if (textValue.startsWith("/checkpoint")) {
      const label = textValue.replace(/^\/checkpoint\s*/, "").trim() || "telegram"
      await options.telegram.sendMessage(chatId, await options.commands.checkpoint(label))
      return
    }

    const prompt = textValue.startsWith("/run ") ? textValue.slice(5).trim() : textValue.startsWith("/") ? "" : textValue
    if (!prompt) {
      await options.telegram.sendMessage(chatId, `Unknown command.\n\n${options.helpText}`)
      return
    }

    const job = await options.queue.enqueueJob({ chatId: String(chatId), prompt })
    await options.onJobDelegation?.(typeof job === "object" && job && "id" in job ? String((job as { id?: string }).id ?? "") : undefined)
  }

  return {
    handleMessage,
  }
}
