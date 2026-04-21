import type { WorkerJob } from "./types"

export function createTelegramRunner(options: {
  queue: {
    reapExpiredLeases(now?: string): Promise<number>
    claimNextJob(leaseOwner: string, claimedAt?: string): Promise<WorkerJob | null>
    completeJob(jobId: string, answer: string, completedAt?: string): Promise<unknown>
    failJob(jobId: string, error: string, completedAt?: string): Promise<unknown>
    markDelivered(jobId: string, deliveredAt?: string): Promise<unknown>
  }
  jobs: {
    runJob(jobId: string): Promise<{ status: "done" | "failed"; answer?: string | null; error?: string | null }>
  }
  telegram: {
    sendMessage(chatId: number, text: string): Promise<void>
    sendChatAction(chatId: number, action: string): Promise<void>
  }
  sleep(ms: number): Promise<void>
  typingIntervalMs: number
  leaseOwner?: string
}) {
  async function withTyping(chatId: number, work: () => Promise<void>) {
    let active = true
    const loop = (async () => {
      while (active) {
        await options.telegram.sendChatAction(chatId, "typing").catch(() => {})
        await options.sleep(options.typingIntervalMs)
      }
    })()

    try {
      await work()
    } finally {
      active = false
      await loop.catch(() => {})
    }
  }

  async function runOnce() {
    await options.queue.reapExpiredLeases()
    const job = await options.queue.claimNextJob(options.leaseOwner ?? "telegram-runner")
    if (!job || job.telegramDeliveredAt) return false

    await withTyping(Number(job.chatId), async () => {
      const result = await options.jobs.runJob(job.id)
      if (result.status === "done") {
        const answer = result.answer ?? ""
        await options.queue.completeJob(job.id, answer)
        await options.telegram.sendMessage(Number(job.chatId), answer)
      } else {
        const error = result.error ?? "job failed"
        await options.queue.failJob(job.id, error)
        await options.telegram.sendMessage(Number(job.chatId), `Error: ${error}`)
      }
      await options.queue.markDelivered(job.id)
    })

    return true
  }

  return {
    runOnce,
  }
}
