export type RuntimeDaemonStatus = "starting" | "running" | "stale" | "failed" | "stopped"

export type WorkerJobStatus = "pending" | "running" | "done" | "failed"

export type HealthState = {
  ok: boolean
  daemonStatus: RuntimeDaemonStatus
  sessionName: string | null
  workspacePath: string | null
  pid: number | null
  restartCount: number
  lastHeartbeatAt: string | null
  lastSuccessAt: string | null
  bootstrapVersion: string | null
  notes: string[]
}

export type SessionState = {
  runtimeVersion: string
  activeSessionName: string
  activeWorkspacePath: string
  piPid: number | null
  supervisorPid: number | null
  daemonStatus: RuntimeDaemonStatus
  restartCount: number
  lastStartedAt: string | null
  lastRestartedAt: string | null
}

export type WorkerJob = {
  id: string
  chatId: string
  prompt: string
  status: WorkerJobStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  answer: string | null
  error: string | null
  sequence?: number
  telegramDeliveredAt?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: string | null
  backend?: string | null
  resultFormat?: string | null
}
