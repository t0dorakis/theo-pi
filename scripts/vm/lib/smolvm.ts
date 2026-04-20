import { readFile } from "node:fs/promises"

export type SmolVmConfig = {
  cliPath?: string
  vmName: string
  backend: string
  memoryMib: number
  diskSizeMib: number
  guestWorkdir: string
  guestPiDir: string
  hostPiAuthPath: string
  hostPiSettingsPath?: string
  guestProvider?: string
  guestModel?: string
}

type VmRow = {
  name: string
  status: string
  sshPort: number | null
}

type HostRun = (command: string, args?: string[]) => Promise<string>

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function parseListPayload(payload: string, vmName: string): VmRow | null {
  const parsed = JSON.parse(payload) as { data?: { vms?: Array<{ name?: string; status?: string; ssh_port?: number | null }> } }
  const row = parsed.data?.vms?.find((entry) => entry.name === vmName)
  return row ? { name: row.name ?? vmName, status: row.status ?? "unknown", sshPort: row.ssh_port ?? null } : null
}

export function buildGuestPiCommand(input: { workdir: string; promptPath: string; provider?: string; model?: string }) {
  const flags = [input.provider ? `--provider ${input.provider}` : "", input.model ? `--model ${input.model}` : ""]
    .filter(Boolean)
    .join(" ")
  return `export PATH=/usr/local/bin:$PATH; cd ${input.workdir}; pi ${flags} -p \"$(cat ${input.promptPath})\" </dev/null`
}

async function maybeRead(path: string) {
  if (!path) return null
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

export function createSmolVmManager(config: SmolVmConfig & { hostRun: HostRun }) {
  async function listVm() {
    const payload = await config.hostRun(config.cliPath ?? "smolvm", ["list", "--json", "--all"])
    return parseListPayload(payload, config.vmName)
  }

  async function ensureVm() {
    const existing = await listVm()
    if (existing) {
      if (existing.status !== "running") {
        await config.hostRun(config.cliPath ?? "smolvm", ["ssh", config.vmName, "--", "true"])
      }
      return
    }

    await config.hostRun(config.cliPath ?? "smolvm", [
      "create",
      "--name",
      config.vmName,
      "--backend",
      config.backend,
      "--disk-size-mib",
      String(config.diskSizeMib),
      "--memory-mib",
      String(config.memoryMib),
      "--os",
      "ubuntu",
      "--json",
    ])
  }

  async function getSshPort() {
    await ensureVm()
    const vm = await listVm()
    if (!vm?.sshPort) {
      throw new Error(`SmolVM ${config.vmName} missing ssh port`)
    }
    return vm.sshPort
  }

  async function ssh(command: string) {
    const port = await getSshPort()
    return config.hostRun("ssh", [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-p",
      String(port),
      "root@127.0.0.1",
      "bash",
      "-lc",
      command,
    ])
  }

  async function stageGuestFile(path: string, content: string) {
    const script = `mkdir -p $(dirname ${shellEscape(path)}) && cat > ${shellEscape(path)} <<'__PI_EOF__'\n${content}\n__PI_EOF__`
    await ssh(script)
  }

  async function bootstrapGuest() {
    await ssh(`mkdir -p ${config.guestWorkdir} ${config.guestPiDir}`)
    const auth = await maybeRead(config.hostPiAuthPath)
    if (!auth) {
      throw new Error(`Missing host Pi auth file: ${config.hostPiAuthPath}`)
    }
    await stageGuestFile(`${config.guestPiDir}/auth.json`, auth)

    const settings =
      (await maybeRead(config.hostPiSettingsPath ?? "")) ??
      JSON.stringify(
        {
          defaultProvider: config.guestProvider ?? "openai-codex",
          defaultModel: config.guestModel ?? "gpt-5.4",
        },
        null,
        2,
      )
    await stageGuestFile(`${config.guestPiDir}/settings.json`, settings)
  }

  async function preflightGuest() {
    await bootstrapGuest()
    await ssh(
      [
        "set -euo pipefail",
        "command -v node >/dev/null",
        "command -v npm >/dev/null",
        "command -v pi >/dev/null",
        `[ -f ${shellEscape(`${config.guestPiDir}/auth.json`)} ]`,
        `[ -f ${shellEscape(`${config.guestPiDir}/settings.json`)} ]`,
      ].join("; "),
    )
  }

  async function runGuest(command: string) {
    return ssh(command)
  }

  async function deleteVm() {
    await config.hostRun(config.cliPath ?? "smolvm", ["delete", config.vmName])
  }

  return {
    ensureVm,
    runGuest,
    preflightGuest,
    stageGuestFile,
    deleteVm,
  }
}
