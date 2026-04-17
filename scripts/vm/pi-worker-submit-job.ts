#!/usr/bin/env bun
import { getRuntimeEnv } from "./lib/env"
import { createJobQueue } from "./lib/jobs"

const env = getRuntimeEnv()
const queue = createJobQueue(env.stateDir)

const [chatId, ...promptParts] = process.argv.slice(2)
const prompt = promptParts.join(" ").trim()

if (!chatId || !prompt) {
  console.error("usage: pi-worker-submit-job <chatId> <prompt>")
  process.exit(1)
}

const job = await queue.enqueueJob({
  chatId,
  prompt,
})

console.log(JSON.stringify(job))
