import type { WorkerBackend } from "./backend"
import type { RuntimeEnv } from "./env"
import { createAcpxBackend } from "./backends/acpx-backend"
import { createSmolVmBackend } from "./backends/smolvm-backend"
import { createTmuxBackend } from "./backends/tmux-backend"

export function createBackend(options: {
  env: RuntimeEnv
  runLocal: (command: string, args?: string[]) => Promise<string>
}): WorkerBackend {
  switch (options.env.backend) {
    case "tmux":
      return createTmuxBackend({
        session: options.env.session,
        captureLines: options.env.jobCaptureLines,
        delegateScript: options.env.tmux?.delegateScript,
        stateDir: options.env.stateDir,
        runLocal: options.runLocal,
      })
    case "smolvm":
      return createSmolVmBackend({
        session: options.env.session,
        stateDir: options.env.stateDir,
        runLocal: options.runLocal,
        smolvm: options.env.smolvm,
      })
    case "acpx":
      return createAcpxBackend({
        stateDir: options.env.stateDir,
        acpxCommand: options.env.acpx.command,
        agent: options.env.acpx.agent,
        cwd: options.env.acpx.cwd,
        runLocal: options.runLocal,
      })
    default:
      return assertNever(options.env.backend)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported worker backend: ${String(value)}`)
}
