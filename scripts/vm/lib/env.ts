import type { WorkerBackendId } from "./backend"

export type AcpxConfig = {
  command: string
  agent: string
  cwd: string | undefined
}

export type SmolVmConfig = {
  cliPath: string
  vmName: string
  sshKeyPath: string
  backend: string
  memoryMib: number
  diskSizeMib: number
  guestWorkdir: string
  guestPiDir: string
  hostPiAuthPath: string
  hostPiSettingsPath: string
  guestProvider: string
  guestModel: string
}

export type TmuxConfig = {
  /** Override path for the pi-worker-delegate script. */
  delegateScript: string | undefined
}

export type RuntimeEnv = {
  backend: WorkerBackendId
  tmux: TmuxConfig
  acpx: AcpxConfig
  smolvm: SmolVmConfig

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

    tmux: {
      delegateScript: process.env.PI_WORKER_DELEGATE_SCRIPT || undefined,
    },

    acpx: {
      command: process.env.ACPX_COMMAND ?? "acpx",
      agent: process.env.ACPX_AGENT ?? "pi",
      cwd: process.env.ACPX_CWD || undefined,
    },

    smolvm: {
      cliPath: process.env.SMOLVM_CLI_PATH ?? "smolvm",
      vmName: process.env.SMOLVM_VM_NAME ?? "",
      sshKeyPath: process.env.SMOLVM_SSH_KEY_PATH ?? "",
      backend: process.env.SMOLVM_BACKEND ?? "apple",
      memoryMib: intFromEnv("SMOLVM_MEMORY_MIB", 4096),
      diskSizeMib: intFromEnv("SMOLVM_DISK_SIZE_MIB", 20480),
      guestWorkdir: process.env.SMOLVM_GUEST_WORKDIR ?? "/root/jobs",
      guestPiDir: process.env.SMOLVM_GUEST_PI_DIR ?? "",
      hostPiAuthPath: process.env.SMOLVM_HOST_PI_AUTH_PATH ?? `${homeDir}/.pi/auth.json`,
      hostPiSettingsPath: process.env.SMOLVM_HOST_PI_SETTINGS_PATH ?? "",
      guestProvider: process.env.SMOLVM_GUEST_PROVIDER ?? "",
      guestModel: process.env.SMOLVM_GUEST_MODEL ?? "",
    },

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
