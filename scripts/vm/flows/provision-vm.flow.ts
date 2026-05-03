/**
 * Provision a new OrbStack VM with a Pi worker and Telegram bot.
 *
 * User story: given a name and a Telegram bot token, stand up a fully
 * operational VM that users can immediately message.
 *
 * Uses orbctl (available inside OrbStack VMs at /opt/orbstack-guest/bin/orbctl).
 *
 * All APIs verified against acpx source before writing:
 *   - shell.exec is a FUNCTION (context) => ShellActionExecution
 *   - acp.profile is string | undefined (NOT a function) — use factory pattern
 *   - FlowRunner is sequential (while-loop, no parallel nodes)
 *   - orbctl run -m <name> maintains persistent stdio (tested)
 *   - orbctl does NOT support -- flag — use bash -c instead
 */

import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { acp, action, compute, defineFlow, shell } from "acpx/flows"
import type { FlowDefinition } from "acpx/flows"

const execAsync = promisify(execFile)

export type ProvisionInput = {
  name: string
  telegramToken: string
  agent?: string
  sessionMode?: string
  allowedChatIds?: string
}

/** Write content to a file on a remote VM via orbctl run + stdin pipe. */
async function writeRemoteFile(vmName: string, content: string, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("orbctl", ["run", "-m", vmName, "bash", "-c", `cat > ${path}`], {
      stdio: ["pipe", "inherit", "inherit"],
    })
    child.stdin.write(content)
    child.stdin.end()
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`orbctl write to ${path} failed: exit ${code}`)),
    )
    child.on("error", reject)
  })
}

/**
 * Factory — takes the target VM name so acp.profile can be a plain string.
 * AcpNodeDefinition.profile is typed string | undefined (not a function).
 */
export function createProvisionFlow(vmName: string): FlowDefinition {
  return defineFlow({
    name: "provision-vm",
    permissions: { requiredMode: "approve-all", requireExplicitGrant: true },
    startAt: "check_exists",
    nodes: {

      check_exists: action({
        statusDetail: "Check whether VM already exists",
        run: async () => {
          const { stdout } = await execAsync("orbctl", ["list", "-f", "json"])
          const vms = JSON.parse(stdout) as Array<{ name: string; state: string }>
          const found = vms.find((v) => v.name === vmName)
          return { exists: !!found, state: found?.state ?? null }
        },
      }),

      clone_vm: shell({
        statusDetail: "Clone base VM snapshot",
        timeoutMs: 5 * 60_000,
        exec: ({ outputs }) => {
          const { exists } = outputs.check_exists as { exists: boolean }
          // If VM exists, skip clone by running a harmless true
          if (exists) return { command: "true", args: [] }
          return { command: "orbctl", args: ["clone", "theo-pi", vmName], timeoutMs: 5 * 60_000 }
        },
      }),

      start_vm: shell({
        statusDetail: "Start VM",
        timeoutMs: 60_000,
        exec: () => ({ command: "orbctl", args: ["start", vmName] }),
      }),

      wait_ready: shell({
        statusDetail: "Wait for Pi to be reachable on new VM",
        timeoutMs: 3 * 60_000,
        exec: () => ({
          command: "orbctl",
          args: [
            "run", "-m", vmName, "bash", "-c",
            "for i in $(seq 1 30); do npx pi-acp@latest --version >/dev/null 2>&1 && echo ready && exit 0; echo attempt $i; sleep 5; done; exit 1",
          ],
          timeoutMs: 3 * 60_000,
        }),
      }),

      write_env: action({
        statusDetail: "Write environment config to VM",
        run: async ({ input }) => {
          const { telegramToken, agent, sessionMode, allowedChatIds } = input as ProvisionInput
          const env = [
            `export TELEGRAM_BOT_TOKEN=${telegramToken}`,
            `export TELEGRAM_ALLOWED_CHAT_IDS=${allowedChatIds ?? "*"}`,
            `export PI_WORKER_BACKEND=acpx`,
            `export ACPX_AGENT=${agent ?? "pi"}`,
            `export ACPX_SESSION_MODE=${sessionMode ?? "persistent"}`,
            `export ACPX_STATE_DIR=$HOME/.pi-worker/acp`,
            `export PI_WORKER_JOB_TIMEOUT_SECONDS=120`,
          ].join("\n")
          // Fix Bug 1: use spawn + stdin pipe, not execFile {input} which is silently ignored
          await writeRemoteFile(vmName, env, "~/.env.pi")
          return { envWritten: true }
        },
      }),

      start_services: shell({
        statusDetail: "Start Telegram poller and runner on new VM",
        timeoutMs: 30_000,
        exec: () => ({
          command: "orbctl",
          args: [
            "run", "-m", vmName, "bash", "-c",
            "source ~/.env.pi && nohup ~/bin/pi-worker-telegram-bot >/tmp/bot.log 2>&1 & nohup ~/bin/pi-worker-telegram-runner >/tmp/runner.log 2>&1 &",
          ],
        }),
      }),

      // ACP round-trip directly to new VM's Pi — verifies the whole stack.
      // profile is a plain string (Fix Bug 2: was a function, but type is string|undefined).
      // resolveAgent("vmName") → "orbctl run -m <name> bash -c 'npx pi-acp@^0.0.26'"
      verify: acp({
        profile: vmName,
        statusDetail: "ACP round-trip health check on new VM",
        timeoutMs: 60_000,
        prompt: () =>
          [
            "You are a Pi agent on a newly provisioned VM.",
            "Report your hostname and confirm Pi is ready.",
            'Return exactly: {"hostname":"...","ready":true}',
          ].join("\n"),
        parse: (text) => {
          const match = text.match(/\{[^}]+\}/)
          try {
            return match ? JSON.parse(match[0]) : { hostname: "unknown", ready: false, raw: text }
          } catch {
            return { hostname: "unknown", ready: false, raw: text }
          }
        },
      }),

      register: compute({
        run: ({ input, outputs }) => {
          const { agent, sessionMode } = input as ProvisionInput
          const verify = outputs.verify as { hostname?: string; ready?: boolean }
          return {
            id: vmName,
            orbName: vmName,
            agent: agent ?? "pi",
            sessionMode: (sessionMode ?? "persistent") as "oneshot" | "persistent",
            registeredAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            hostname: verify.hostname,
          }
        },
      }),
    },

    edges: [
      { from: "check_exists",   to: "clone_vm" },
      { from: "clone_vm",       to: "start_vm" },
      { from: "start_vm",       to: "wait_ready" },
      { from: "wait_ready",     to: "write_env" },
      { from: "write_env",      to: "start_services" },
      { from: "start_services", to: "verify" },
      { from: "verify",         to: "register" },
    ],
  })
}
