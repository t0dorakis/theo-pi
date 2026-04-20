import type { WorkerBackend, WorkerBackendId } from "./backend"
import type { RuntimeEnv } from "./env"
import { createSmolVmBackend } from "./backends/smolvm-backend"
import { createTmuxBackend } from "./backends/tmux-backend"

export function createBackend(options: {
  env: RuntimeEnv
  runLocal: (command: string, args?: string[]) => Promise<string>
  delegateScript?: string
}): WorkerBackend {
  switch (options.env.backend) {
    case "tmux":
      return createTmuxBackend({
        session: options.env.session,
        captureLines: options.env.jobCaptureLines,
        delegateScript: options.delegateScript,
        stateDir: options.env.stateDir,
        runLocal: options.runLocal,
      })
    case "smolvm":
      return createSmolVmBackend({
        session: options.env.session,
        stateDir: options.env.stateDir,
        runLocal: options.runLocal,
        smolvm: {
          cliPath: options.env.smolvmCliPath,
          vmName: options.env.smolvmVmName,
          backend: options.env.smolvmBackend,
          memoryMib: options.env.smolvmMemoryMib,
          diskSizeMib: options.env.smolvmDiskSizeMib,
          guestWorkdir: options.env.smolvmGuestWorkdir,
          guestPiDir: options.env.smolvmGuestPiDir,
          hostPiAuthPath: options.env.smolvmHostPiAuthPath,
          hostPiSettingsPath: options.env.smolvmHostPiSettingsPath,
          guestProvider: options.env.smolvmGuestProvider,
          guestModel: options.env.smolvmGuestModel,
        },
      })
    default:
      return assertNever(options.env.backend)
  }
}

function assertNever(value: never): WorkerBackend {
  throw new Error(`Unsupported worker backend: ${String(value)}`)
}

export type { WorkerBackendId }
