import type { WorkerJob } from "./types"

export type WorkerBackendId = "tmux" | "smolvm" | "acpx"

/**
 * Execution backend for pi-worker jobs.
 *
 * ## submitPrompt contract
 *
 * Backends fall into two execution models:
 *
 * - **Fire-and-poll** (tmux): `submitPrompt` dispatches the job and returns
 *   immediately. The caller polls `readResult` until an answer or timeout.
 *
 * - **Blocking-run** (acpx, smolvm): `submitPrompt` runs the entire job
 *   synchronously and writes the result before resolving. `readResult` is a
 *   cheap file read — it will return the answer immediately after
 *   `submitPrompt` resolves.
 *
 * Callers must not assume either model. Use `readResult` polling for all
 * backends; blocking backends will simply return on the first poll.
 */
export interface WorkerBackend {
  submitPrompt(job: WorkerJob): Promise<void>
  readResult(job: WorkerJob): Promise<string | null>
  sessionHealth(): Promise<{ ok: boolean; detail?: string }>
  /** Cancel an in-flight job. No-op if cancellation is not supported. */
  cancel(jobId: string): Promise<void>
}
