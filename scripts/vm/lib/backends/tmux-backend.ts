import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"

export function markerPair(jobId: string) {
  const markerId = jobId.replace(/[^a-zA-Z0-9]/g, "").slice(-10)
  return {
    startMarker: `<final_answer id="${markerId}">`,
    endMarker: "</final_answer>",
  }
}

export function formatDelegatedPrompt(job: WorkerJob) {
  const { startMarker, endMarker } = markerPair(job.id)
  return [
    "Return your final answer only inside these exact XML tags.",
    `Start tag: ${startMarker}`,
    `End tag: ${endMarker}`,
    "Rules:",
    `- Output exactly one ${startMarker} block and one ${endMarker}.`,
    "- Put only final answer text between tags.",
    "- No text before start tag.",
    "- No text after end tag.",
    "- No markdown fences.",
    "- If you cannot complete request, still return brief explanation inside tags.",
    `User request: ${job.prompt}`,
  ].join("\n")
}

export function extractAnswerFromPane(pane: string, jobId: string) {
  const { startMarker, endMarker } = markerPair(jobId)
  const start = pane.lastIndexOf(startMarker)
  if (start === -1) return null
  const afterStart = pane.slice(start + startMarker.length)
  const end = afterStart.indexOf(endMarker)
  if (end === -1) return null
  return afterStart.slice(0, end).replace(/^[\s]+|[\s]+$/g, "")
}

export function createTmuxBackend(options: {
  session: string
  captureLines?: number
  delegateScript?: string
  stateDir?: string
  runLocal: (command: string, args?: string[]) => Promise<string>
}): WorkerBackend {
  const captureLines = options.captureLines ?? 500
  const resultChannel = options.stateDir ? createResultChannel(options.stateDir) : null

  return {
    async submitPrompt(job: WorkerJob) {
      await options.runLocal(options.delegateScript ?? "pi-worker-delegate", [options.session, formatDelegatedPrompt(job)])
    },
    async readResult(job: WorkerJob) {
      if (resultChannel) {
        try {
          const result = await resultChannel.readResult(job.id)
          return result.status === "done" ? (result.answer ?? null) : null
        } catch {
          // fall through until result file exists
        }
      }
      const pane = await options
        .runLocal("tmux", ["capture-pane", "-J", "-pt", `${options.session}:0`, "-S", `-${captureLines}`])
        .catch(() => "")
      const answer = extractAnswerFromPane(pane, job.id)
      if (answer && resultChannel) {
        await resultChannel.writeResult({
          id: job.id,
          backendId: "tmux",
          status: "done",
          answer,
          completedAt: nowIso(),
        })
      }
      return answer
    },
    async sessionHealth() {
      try {
        await options.runLocal("tmux", ["has-session", "-t", options.session])
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
