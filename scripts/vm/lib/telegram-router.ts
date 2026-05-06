import type { Message } from "grammy/types"

export type TelegramRoute =
  | { type: "ignore" }
  | { type: "command"; command: "help" | "start" | "status" | "reset" | "restart" | "logs" | "checkpoint"; arg: string }
  | { type: "prompt"; prompt: string }
  | { type: "reply"; text: string }

export type TextMessage = Message.TextMessage

function isGroupChat(message: TextMessage) {
  return message.chat.type === "group" || message.chat.type === "supergroup"
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function stripBotMention(text: string, botUsername: string) {
  const pattern = new RegExp(`(^|\\s)@${escapeRegExp(botUsername)}(?=\\s|$)`, "ig")
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim()
}

function isReplyToBot(message: TextMessage, botUsername: string) {
  const from = message.reply_to_message?.from
  return from?.is_bot === true && from.username?.toLowerCase() === botUsername
}

function parseCommand(text: string, botUsername: string, group: boolean) {
  const trimmed = text.trim()
  const mentionPrefix = new RegExp(`^@${escapeRegExp(botUsername)}\\s+`, "i")
  const withoutPrefix = trimmed.replace(mentionPrefix, "").trim()
  const match = withoutPrefix.match(/^(\/[A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/)
  if (!match) return null

  const target = match[2]?.toLowerCase()
  if (group && target && target !== botUsername) return null
  if (group && !target && withoutPrefix === trimmed) return null

  return {
    command: match[1].slice(1).toLowerCase(),
    arg: (match[3] ?? "").trim(),
  }
}

export function routeTelegramTextMessage(input: {
  message: TextMessage
  botUsername: string
  requireMentionInGroups?: boolean
}): TelegramRoute {
  const botUsername = input.botUsername.replace(/^@/, "").toLowerCase().trim()
  if (!botUsername) return { type: "ignore" }

  const text = input.message.text.trim()
  if (!text) return { type: "ignore" }

  const group = isGroupChat(input.message)
  const requireMention = input.requireMentionInGroups ?? true
  const command = parseCommand(text, botUsername, group)
  if (command) {
    switch (command.command) {
      case "help":
      case "start":
      case "status":
      case "reset":
      case "restart":
      case "logs":
      case "checkpoint":
        return { type: "command", command: command.command, arg: command.arg }
      case "run":
        return command.arg ? { type: "prompt", prompt: command.arg } : { type: "reply", text: "Usage: /run <prompt>" }
      default:
        return { type: "reply", text: `Unknown command: /${command.command}. Try /help.` }
    }
  }

  if (!group || !requireMention) return { type: "prompt", prompt: text }

  if (isReplyToBot(input.message, botUsername)) return { type: "prompt", prompt: text }

  const prompt = stripBotMention(text, botUsername)
  return prompt === text ? { type: "ignore" } : { type: "prompt", prompt }
}
