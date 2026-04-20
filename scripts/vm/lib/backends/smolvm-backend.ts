import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import { buildGuestPiCommand, createSmolVmManager, type SmolVmConfig } from "../smolvm"
import type { WorkerJob } from "../types"

function sanitizeGuestAnswer(output: string) {
  return output
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("Warning: Permanently added '[127.0.0.1]:"))
    .join("\n")
    .trim()
}

export function createSmolVmBackend(options: {
  session: string
  stateDir: string
  runLocal: (command: string, args?: string[]) => Promise<string>
  smolvm: SmolVmConfig
}): WorkerBackend {
  const resultChannel = createResultChannel(options.stateDir)
  const smolvm = createSmolVmManager({
    ...options.smolvm,
    hostRun: options.runLocal,
  })

  return {
    async submitPrompt(job: WorkerJob) {
      const jobDir = `${options.smolvm.guestWorkdir}/${job.id}`
      const promptPath = `${jobDir}/prompt.txt`

      try {
        await smolvm.preflightGuest()
        await smolvm.runGuest(`mkdir -p ${jobDir}`)
        await smolvm.stageGuestFile(promptPath, job.prompt)
        const answer = (await smolvm.runGuest(
          buildGuestPiCommand({
            workdir: jobDir,
            promptPath,
            piDir: options.smolvm.guestPiDir,
            provider: options.smolvm.guestProvider,
            model: options.smolvm.guestModel,
          }),
        )).trim()
        await resultChannel.writeResult({
          id: job.id,
          backendId: "smolvm",
          status: "done",
          answer: sanitizeGuestAnswer(answer),
          completedAt: nowIso(),
        })
      } catch (error) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "smolvm",
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          completedAt: nowIso(),
        })
      }
    },
    async readResult(job: WorkerJob) {
      const result = await resultChannel.readResult(job.id)
      if (result.status === "failed") {
        throw new Error(result.error ?? "smolvm job failed")
      }
      return result.answer ?? null
    },
    async sessionHealth() {
      try {
        await smolvm.preflightGuest()
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
    async cancel() {
      return
    },
  }
}
