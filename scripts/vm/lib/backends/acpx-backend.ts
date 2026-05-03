import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"

export function createAcpxBackend(options: {
  stateDir: string
  agent: string
  acpxCommand?: string
  cwd?: string
  /** Timeout in milliseconds for a single exec call. Defaults to 10 minutes. */
  timeoutMs?: number
  runLocal: (command: string, args?: string[]) => Promise<string>
}): WorkerBackend {
  const acpx = options.acpxCommand ?? "acpx"
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const resultChannel = createResultChannel(options.stateDir)

  async function runWithTimeout(command: string, args: string[]): Promise<string> {
    return Promise.race([
      options.runLocal(command, args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`acpx exec timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])
  }

  return {
    async submitPrompt(job: WorkerJob) {
      const args: string[] = [options.agent, "exec", "--format", "quiet", "--approve-all"]
      if (options.cwd) args.push("--cwd", options.cwd)
      args.push(job.prompt)

      try {
        const answer = await runWithTimeout(acpx, args)
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx",
          status: "done",
          answer: answer.trim(),
          completedAt: nowIso(),
        })
      } catch (error) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx",
          status: "failed",
          error: `acpx exec failed: ${error instanceof Error ? error.message : String(error)}`,
          completedAt: nowIso(),
        })
      }
    },

    async readResult(job: WorkerJob) {
      const result = await resultChannel.readResult(job.id).catch(() => null)
      if (!result) return null
      if (result.status === "failed") throw new Error(result.error ?? "acpx job failed")
      return result.answer ?? null
    },

    async sessionHealth() {
      try {
        await options.runLocal(acpx, ["--version"])
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          detail: `acpx unavailable: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    async cancel(_jobId: string) {
      // exec-mode jobs are one-shot — no live session to cancel.
      // Future persistent sessions: acpx <agent> cancel -s <jobId>
    },
  }
}
