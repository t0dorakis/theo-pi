import { expect, test } from "bun:test"

import { createTelegramPoller } from "./telegram-poller"

test("poller enqueues plain text and does not run jobs", async () => {
  const enqueued: Array<{ chatId: string; prompt: string }> = []
  const sent: string[] = []
  const poller = createTelegramPoller({
    queue: { enqueueJob: async (job: { chatId: string; prompt: string }) => void enqueued.push(job) },
    telegram: {
      assertAllowed: () => {},
      sendMessage: async (_chatId: number, text: string) => void sent.push(text),
    },
    commands: {
      status: async () => "status",
      restart: async () => "restart",
      logs: async () => "logs",
      checkpoint: async () => "checkpoint",
    },
    onJobDelegation: async () => {},
    helpText: "help",
  })

  await poller.handleMessage({ chat: { id: 123 }, text: "Hi there" })

  expect(enqueued).toEqual([{ chatId: "123", prompt: "Hi there" }])
  expect(sent).toHaveLength(0)
})

test("poller handles help immediately", async () => {
  const sent: string[] = []
  const poller = createTelegramPoller({
    queue: { enqueueJob: async () => undefined },
    telegram: {
      assertAllowed: () => {},
      sendMessage: async (_chatId: number, text: string) => void sent.push(text),
    },
    commands: {
      status: async () => "status",
      restart: async () => "restart",
      logs: async () => "logs",
      checkpoint: async () => "checkpoint",
    },
    helpText: "help text",
  })

  await poller.handleMessage({ chat: { id: 123 }, text: "/help" })
  expect(sent).toEqual(["help text"])
})
