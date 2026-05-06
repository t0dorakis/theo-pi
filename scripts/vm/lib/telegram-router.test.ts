import { expect, test } from "bun:test"

import { routeTelegramTextMessage, type TextMessage } from "./telegram-router"

const base = (text: string, chat: TextMessage["chat"] = { id: 1, type: "private", first_name: "Theo" }): TextMessage => ({
  message_id: 1,
  date: 1,
  text,
  chat,
  from: { id: 1, is_bot: false, first_name: "Theo" },
})

const group = { id: -5233300787, type: "group" as const, title: "Erbe" }

const route = (message: TextMessage) => routeTelegramTextMessage({ message, botUsername: "erbrecht_bot" })

test("private chat routes plain text and commands", () => {
  expect(route(base("hi"))).toEqual({ type: "prompt", prompt: "hi" })
  expect(route(base("/status"))).toEqual({ type: "command", command: "status", arg: "" })
})

test("group ignores unmentioned plain text", () => {
  expect(route(base("hi", group))).toEqual({ type: "ignore" })
})

test("supergroup mention routes as prompt", () => {
  expect(route(base("@erbrecht_bot hi", { id: -1005233300787, type: "supergroup", title: "Erbe" }))).toEqual({ type: "prompt", prompt: "hi" })
})

test("group routes mention anywhere as prompt and strips mentions", () => {
  expect(route(base("@erbrecht_bot hi", group))).toEqual({ type: "prompt", prompt: "hi" })
  expect(route(base("hi @erbrecht_bot bitte", group))).toEqual({ type: "prompt", prompt: "hi bitte" })
})

test("group routes slash command targeted to bot", () => {
  expect(route(base("/status@erbrecht_bot", group))).toEqual({ type: "command", command: "status", arg: "" })
  expect(route(base("@erbrecht_bot /status", group))).toEqual({ type: "command", command: "status", arg: "" })
  expect(route(base("/status@other_bot", group))).toEqual({ type: "ignore" })
})

test("natural mention plus non-slash command remains prompt", () => {
  expect(route(base("@erbrecht_bot status", group))).toEqual({ type: "prompt", prompt: "status" })
})

test("empty run and unknown commands produce explicit replies", () => {
  expect(route(base("/run"))).toEqual({ type: "reply", text: "Usage: /run <prompt>" })
  expect(route(base("/nope"))).toEqual({ type: "reply", text: "Unknown command: /nope. Try /help." })
})

test("reply to bot routes without mention", () => {
  expect(route({
    ...base("was heißt das für Edda?", group),
    reply_to_message: {
      message_id: 2,
      date: 1,
      chat: group,
      text: "Antwort",
      from: { id: 7998247284, is_bot: true, first_name: "erbrecht-bot", username: "erbrecht_bot" },
      reply_to_message: undefined,
    },
  })).toEqual({ type: "prompt", prompt: "was heißt das für Edda?" })
})
