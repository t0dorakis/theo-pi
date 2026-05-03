/**
 * acpx backend for pi-worker.
 *
 * Uses `acpx <agent> exec --format quiet --approve-all` to submit one-shot
 * prompts to any ACP-compatible coding agent (pi, codex, claude, etc.) without
 * PTY scraping.  The full agent response is captured from stdout and written to
 * the result channel so `readResult` can retrieve it synchronously.
 *
 * This replaces the XML-marker / tmux-pane-scraping approach for agent runtimes
 * that expose an ACP server.  The tmux backend remains available for deployments
 * where the agent does not yet have an ACP adapter.
 *
 * Key differences from tmux backend:
 *   - Structured protocol output — no ANSI noise, no pane capture, no polling
 *   - Any ACP-compatible agent switchable via ACPX_AGENT env var
 *   - Cancellation is a no-op for exec mode; persistent sessions can be added later
 *
 * Env vars:
 *   PI_WORKER_BACKEND=acpx          select this backend
 *   ACPX_COMMAND=acpx               path/name of the acpx binary (default: acpx)
 *   ACPX_AGENT=pi                   ACP agent to use (default: pi)
 *   ACPX_CWD=<path>                 working directory / session scope (optional)
 */

import type { WorkerBackend } from "../backend"
import { createResultChannel } from "../result-channel"
import { nowIso } from "../time"
import type { WorkerJob } from "../types"

export function createAcpxBackend(options: {
  stateDir: string
  /** ACP agent name from the acpx registry, e.g. "pi", "codex", "claude". */
  agent: string
  /** Override the acpx binary path/name. Defaults to "acpx". */
  acpxCommand?: string
  /**
   * Working directory for the exec session scope.  When set, acpx scopes the
   * temporary session to this directory — useful when the agent needs to see a
   * specific repo.
   */
  cwd?: string
  runLocal: (command: string, args?: string[]) => Promise<string>
}): WorkerBackend {
  const acpx = options.acpxCommand ?? "acpx"
  const resultChannel = createResultChannel(options.stateDir)

  return {
    async submitPrompt(job: WorkerJob) {
      const args: string[] = [
        options.agent,
        "exec",
        "--format",
        "quiet",
        "--approve-all",
      ]

      if (options.cwd) {
        args.push("--cwd", options.cwd)
      }

      // Pass the raw user prompt — no XML wrapper needed.
      args.push(job.prompt)

      try {
        const answer = await options.runLocal(acpx, args)
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx",
          status: "done",
          answer: answer.trim(),
          completedAt: nowIso(),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        await resultChannel.writeResult({
          id: job.id,
          backendId: "acpx",
          status: "failed",
          error: `acpx exec failed: ${detail}`,
          completedAt: nowIso(),
        })
      }
    },

    async readResult(job: WorkerJob) {
      try {
        const result = await resultChannel.readResult(job.id)
        if (result.status === "failed") {
          throw new Error(result.error ?? "acpx job failed")
        }
        return result.answer ?? null
      } catch {
        return null
      }
    },

    async sessionHealth() {
      try {
        // `acpx --version` exits 0 when installed, non-zero otherwise.
        await options.runLocal(acpx, ["--version"])
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          detail: `acpx not found or failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    async cancel(_jobId: string) {
      // exec-mode jobs are one-shot — there is no live session to cancel.
      // Future: for persistent sessions, call `acpx <agent> cancel -s <jobId>`.
    },
  }
}
