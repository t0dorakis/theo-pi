export type AcpxConfig = {
  agent: string
  sessionMode: "oneshot" | "persistent"
  cwd: string | undefined
  /** Acpx session store root (separate from PI_WORKER_STATE_DIR). Default: ~/.pi-worker/acp */
  stateDir: string
  /** Per-turn timeout in milliseconds. Default: 10 minutes. */
  timeoutMs: number
  /** TTL for idle persistent sessions in hours. Default: 24. */
  sessionTtlHours: number
}

export type WorkerEnv = {
  acpx: AcpxConfig

  homeDir: string
  stateDir: string
  workerName: string
  gatewayHost: string
  gatewayPort: number
  gatewayToken: string
  gatewayDrain: boolean
  telegramWebhookSecret: string
  telegramBotToken: string
  telegramAllowedChatIds: Set<string>
  telegramPollTimeoutSeconds: number
  telegramLogLines: number
  telegramTypingIntervalMs: number
  jobTimeoutSeconds: number
  jobPollIntervalMs: number
  jobCaptureLines: number
}

function intFromEnv(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getWorkerEnv(): WorkerEnv {
  const homeDir = process.env.HOME ?? process.cwd()
  return {
    acpx: {
      agent: process.env.ACPX_AGENT ?? "pi",
      sessionMode: (process.env.ACPX_SESSION_MODE === "persistent" ? "persistent" : "oneshot") as "oneshot" | "persistent",
      cwd: process.env.ACPX_CWD || undefined,
      stateDir: process.env.ACPX_STATE_DIR ?? `${homeDir}/.pi-worker/acp`,
      timeoutMs: intFromEnv("ACPX_TIMEOUT_MS", 10 * 60 * 1000),
      sessionTtlHours: intFromEnv("ACPX_SESSION_TTL_HOURS", 24),
    },

    homeDir,
    stateDir: process.env.PI_WORKER_STATE_DIR ?? `${homeDir}/.pi-worker`,
    workerName: process.env.PI_WORKER_NAME ?? process.env.PI_WORKER_SESSION ?? "theo-pi",
    gatewayHost: process.env.PI_WORKER_GATEWAY_HOST ?? "127.0.0.1",
    gatewayPort: intFromEnv("PI_WORKER_GATEWAY_PORT", 8787),
    gatewayToken: process.env.PI_WORKER_GATEWAY_TOKEN ?? "",
    gatewayDrain: process.env.PI_WORKER_GATEWAY_DRAIN !== "0",
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramAllowedChatIds: new Set(
      (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    telegramPollTimeoutSeconds: intFromEnv("TELEGRAM_POLL_TIMEOUT_SECONDS", 30),
    telegramLogLines: intFromEnv("TELEGRAM_LOG_LINES", 20),
    telegramTypingIntervalMs: intFromEnv("TELEGRAM_TYPING_INTERVAL_MS", 4000),
    jobTimeoutSeconds: intFromEnv("PI_WORKER_JOB_TIMEOUT_SECONDS", 600),
    jobPollIntervalMs: intFromEnv("PI_WORKER_JOB_POLL_INTERVAL_MS", 2000),
    jobCaptureLines: intFromEnv("PI_WORKER_JOB_CAPTURE_LINES", 500),
  }
}
