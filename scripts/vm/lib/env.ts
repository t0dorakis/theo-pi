import type { WorkerBackendId } from "./backend"

export type RuntimeEnv = {
  homeDir: string
  stateDir: string
  session: string
  backend: WorkerBackendId
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
  smolvmCliPath: string
  smolvmVmName: string
  smolvmBackend: string
  smolvmMemoryMib: number
  smolvmDiskSizeMib: number
  smolvmGuestWorkdir: string
  smolvmGuestPiDir: string
  smolvmHostPiAuthPath: string
  smolvmHostPiSettingsPath: string
  smolvmGuestProvider: string
  smolvmGuestModel: string
}

function intFromEnv(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function backendFromEnv(): WorkerBackendId {
  const backend = (process.env.PI_WORKER_BACKEND ?? "tmux").trim()
  if (backend === "tmux" || backend === "smolvm") return backend
  throw new Error(`Unsupported PI_WORKER_BACKEND: ${backend}`)
}

export function getRuntimeEnv(): RuntimeEnv {
  const homeDir = process.env.HOME ?? process.cwd()
  const session = process.env.PI_WORKER_SESSION ?? "theo-pi"
  return {
    homeDir,
    stateDir: process.env.PI_WORKER_STATE_DIR ?? `${homeDir}/.pi-worker`,
    session,
    backend: backendFromEnv(),
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
    smolvmCliPath: process.env.SMOLVM_BIN ?? "smolvm",
    smolvmVmName: process.env.SMOLVM_VM_NAME ?? `${session}-smolvm`,
    smolvmBackend: process.env.SMOLVM_BACKEND ?? "qemu",
    smolvmMemoryMib: intFromEnv("SMOLVM_MEMORY_MIB", 4096),
    smolvmDiskSizeMib: intFromEnv("SMOLVM_DISK_SIZE_MIB", 8192),
    smolvmGuestWorkdir: process.env.SMOLVM_GUEST_WORKDIR ?? "~/smolvm-theo-pi",
    smolvmGuestPiDir: process.env.SMOLVM_GUEST_PI_DIR ?? "~/.config/pi",
    smolvmHostPiAuthPath: process.env.SMOLVM_HOST_PI_AUTH_PATH ?? `${homeDir}/.config/pi/auth.json`,
    smolvmHostPiSettingsPath: process.env.SMOLVM_HOST_PI_SETTINGS_PATH ?? "",
    smolvmGuestProvider: process.env.SMOLVM_GUEST_PI_PROVIDER ?? "openai-codex",
    smolvmGuestModel: process.env.SMOLVM_GUEST_PI_MODEL ?? "gpt-5.4",
  }
}
