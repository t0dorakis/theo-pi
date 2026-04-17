import type { WorkerJob } from "./types"

export interface WorkerBackend {
  submitPrompt(job: WorkerJob): Promise<void>
  readResult(job: WorkerJob): Promise<string | null>
  sessionHealth(): Promise<{ ok: boolean; detail?: string }>
  cancel?(jobId: string): Promise<void>
}
