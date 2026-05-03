import type { WorkerBackendId } from "./backend"

export type RuntimeEnv = {
  backend: WorkerBackendId
  // acpx backend
  acpxCommand: string
  acpxAgent: string
  acpxCwd: string
  // smolvm backend
  smolvmCliPath: string
  smolvmVmName: string
  smolvmSshKeyPath: string
  smolvmBackend: string
  smolvmMemoryMib: number
  smolvmDiskSizeMib: number
  smolvmGuestWorkdir: string
  smolvmGuestPiDir: string
  smolvmHostPiAuthPath: string
  smolvmHostPiSettingsPath: string
  smolvmGuestProvider: string
  smolvmGuestModel: string

  homeDir: string
  stateDir: string
  session: string
  gatewayHost: string
  gatewayPort: number
  gatewayToken: string
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

export function getRuntimeEnv(): RuntimeEnv {
  const homeDir = process.env.HOME ?? process.cwd()
  return {
    backend: (process.env.PI_WORKER_BACKEND ?? "tmux") as WorkerBackendId,
    acpxCommand: process.env.ACPX_COMMAND ?? "acpx",
    acpxAgent: process.env.ACPX_AGENT ?? "pi",
    acpxCwd: process.env.ACPX_CWD ?? "",
    smolvmCliPath: process.env.SMOLVM_CLI_PATH ?? "smolvm",
    smolvmVmName: process.env.SMOLVM_VM_NAME ?? "",
    smolvmSshKeyPath: process.env.SMOLVM_SSH_KEY_PATH ?? "",
    smolvmBackend: process.env.SMOLVM_BACKEND ?? "apple",
    smolvmMemoryMib: intFromEnv("SMOLVM_MEMORY_MIB", 4096),
    smolvmDiskSizeMib: intFromEnv("SMOLVM_DISK_SIZE_MIB", 20480),
    smolvmGuestWorkdir: process.env.SMOLVM_GUEST_WORKDIR ?? "/root/jobs",
    smolvmGuestPiDir: process.env.SMOLVM_GUEST_PI_DIR ?? "",
    smolvmHostPiAuthPath: process.env.SMOLVM_HOST_PI_AUTH_PATH ?? `${homeDir}/.pi/auth.json`,
    smolvmHostPiSettingsPath: process.env.SMOLVM_HOST_PI_SETTINGS_PATH ?? "",
    smolvmGuestProvider: process.env.SMOLVM_GUEST_PROVIDER ?? "",
    smolvmGuestModel: process.env.SMOLVM_GUEST_MODEL ?? "",

    homeDir,
    stateDir: process.env.PI_WORKER_STATE_DIR ?? `${homeDir}/.pi-worker`,
    session: process.env.PI_WORKER_SESSION ?? "theo-pi",
    gatewayHost: process.env.PI_WORKER_GATEWAY_HOST ?? "127.0.0.1",
    gatewayPort: intFromEnv("PI_WORKER_GATEWAY_PORT", 8787),
    gatewayToken: process.env.PI_WORKER_GATEWAY_TOKEN ?? "",
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
