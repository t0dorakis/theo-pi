import { expect, test } from "bun:test"

import { createTelegramPoller } from "./telegram-poller"

test("poller enqueues plain text and does not run jobs", async () => {
  const enqueued: Array<{ chatId: string; prompt: string }> = []
  const sent: string[] = []
  const poller = createTelegramPoller({
    queue: { enqueueJob: async (job: { chatId: string; prompt: string }) => { enqueued.push(job); return { id: "test-job-1" } } },
    telegram: {
      assertAllowed: () => {},
      sendMessage: async (_chatId: number, text: string) => void sent.push(text),
    },
    commands: {
      status: async () => "status",
      restart: async () => "restart",
      restartGateway: async () => "restart-gateway",
      reload: async () => "reload",
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
      restartGateway: async () => "restart-gateway",
      reload: async () => "reload",
      logs: async () => "logs",
      checkpoint: async () => "checkpoint",
    },
    helpText: "help text",
  })

  await poller.handleMessage({ chat: { id: 123 }, text: "/help" })
  expect(sent).toEqual(["help text"])
})

test("poller handles reload immediately", async () => {
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
      restartGateway: async () => "restart-gateway",
      reload: async () => "reloaded",
      logs: async () => "logs",
      checkpoint: async () => "checkpoint",
    },
    helpText: "help text",
  })

  await poller.handleMessage({ chat: { id: 123 }, text: "/reload" })
  expect(sent).toEqual(["reloaded"])
})

test("poller handles restart-gateway immediately", async () => {
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
      restartGateway: async () => "gateway restarted",
      reload: async () => "reload",
      logs: async () => "logs",
      checkpoint: async () => "checkpoint",
    },
    helpText: "help text",
  })

  await poller.handleMessage({ chat: { id: 123 }, text: "/restart-gateway" })
  expect(sent).toEqual(["gateway restarted"])
})
