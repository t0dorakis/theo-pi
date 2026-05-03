import type { WorkerJob } from "./types"

export type WorkerBackendId = "tmux" | "smolvm" | "acpx"

/**
 * Execution backend for pi-worker jobs.
 *
 * ## submitPrompt contract
 *
 * - **Fire-and-poll** (tmux): dispatches and returns immediately. Caller polls readResult.
 * - **Blocking-run** (acpx, smolvm): runs the full job before resolving. readResult is a cheap file read.
 *
 * Callers must not assume either model — use readResult polling for all backends.
 */
export interface WorkerBackend {
  submitPrompt(job: WorkerJob): Promise<void>
  readResult(job: WorkerJob): Promise<string | null>
  sessionHealth(): Promise<{ ok: boolean; detail?: string }>
  /** Cancel an in-flight job. No-op if the backend does not support cancellation. */
  cancel(jobId: string): Promise<void>
}
