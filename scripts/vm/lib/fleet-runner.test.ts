import { expect, test, mock } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Mock the flow module so tests don't need real acpx
mock.module("../flows/provision-vm.flow", () => ({
  createProvisionFlow: (vmName: string) => ({ name: "provision-vm", _vmName: vmName }),
}))

mock.module("acpx/flows", () => ({
  FlowRunner: class {
    constructor(public opts: unknown) {}
    async run(_flow: unknown, input: Record<string, unknown>) {
      const name = (input.name as string) ?? "test-vm"
      return {
        state: {
          status: "completed",
          outputs: {
            register: {
              id: name,
              orbName: name,
              agent: (input.agent as string) ?? "pi",
              sessionMode: "persistent",
              registeredAt: new Date().toISOString(),
              hostname: name,
            },
          },
          error: undefined,
          currentNode: "register",
        },
        runDir: "/tmp/fake-run",
      }
    }
  },
}))

mock.module("acpx/runtime", () => ({ createFileSessionStore: () => ({}) }))

// Track execFile calls for verification
const execCalls: Array<{ cmd: string; args: string[] }> = []
mock.module("node:child_process", () => ({
  execFile: (cmd: string, args: string[], optsOrCb: unknown, maybeCb?: Function) => {
    const cb = (typeof optsOrCb === "function" ? optsOrCb : maybeCb) as Function
    execCalls.push({ cmd, args })
    if (cmd === "orbctl" && args[0] === "info") {
      cb(null, { stdout: "State: running\nIPv4: 192.168.1.1\n", stderr: "" })
    } else {
      cb(null, { stdout: "", stderr: "" })
    }
  },
  spawn: () => ({
    stdin: { write: () => {}, end: () => {} },
    on: (ev: string, cb: Function) => { if (ev === "close") cb(0) },
  }),
}))

async function makeTmpDir() {
  const d = await mkdtemp(join(tmpdir(), "fleet-test-"))
  await mkdir(join(d, "fleet-runs"), { recursive: true })
  return d
}

async function writeConfig(stateDir: string, vms: Record<string, unknown>) {
  await writeFile(
    join(stateDir, "fleet.json"),
    JSON.stringify({ schema: "pi-worker.fleet.v1", vms }),
    "utf8",
  )
}

test("provision registers VM in fleet.json", async () => {
  const stateDir = await makeTmpDir()
  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })

  const vm = await fleet.provision({ name: "worker-1", telegramToken: "tok" })

  expect(vm.id).toBe("worker-1")
  expect(vm.agent).toBe("pi")
  expect(vm.sessionMode).toBe("persistent")

  const config = JSON.parse(await Bun.file(join(stateDir, "fleet.json")).text())
  expect(config.vms["worker-1"]).toBeDefined()
  await rm(stateDir, { recursive: true })
})

test("provision throws on flow failure", async () => {
  const stateDir = await makeTmpDir()

  mock.module("acpx/flows", () => ({
    FlowRunner: class {
      async run() {
        return { state: { status: "failed", error: "clone timed out", currentNode: "clone_vm" }, runDir: "" }
      }
    },
  }))

  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })

  await expect(fleet.provision({ name: "worker-fail", telegramToken: "tok" }))
    .rejects.toThrow("Provision of")
  await rm(stateDir, { recursive: true })
})

test("status reads orbctl info for each VM", async () => {
  const stateDir = await makeTmpDir()
  await writeConfig(stateDir, {
    "vm-1": { id: "vm-1", orbName: "vm-1", agent: "pi", sessionMode: "persistent", registeredAt: "" },
    "vm-2": { id: "vm-2", orbName: "vm-2", agent: "claude", sessionMode: "oneshot", registeredAt: "" },
  })

  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })
  const entries = await fleet.status()

  expect(entries).toHaveLength(2)
  expect(entries.every(e => e.state === "running")).toBe(true)
  expect(entries.every(e => e.ok)).toBe(true)
  await rm(stateDir, { recursive: true })
})

test("deprovision calls orbctl delete and removes from config", async () => {
  const stateDir = await makeTmpDir()
  execCalls.length = 0
  await writeConfig(stateDir, {
    "vm-del": { id: "vm-del", orbName: "vm-del", agent: "pi", sessionMode: "persistent", registeredAt: "" },
  })

  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })
  await fleet.deprovision("vm-del")

  expect(execCalls.some(c => c.cmd === "orbctl" && c.args[0] === "delete")).toBe(true)

  const config = JSON.parse(await Bun.file(join(stateDir, "fleet.json")).text())
  expect(config.vms["vm-del"]).toBeUndefined()
  await rm(stateDir, { recursive: true })
})

test("deprovision throws for unknown id", async () => {
  const stateDir = await makeTmpDir()
  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })

  await expect(fleet.deprovision("ghost")).rejects.toThrow("not found in fleet")
  await rm(stateDir, { recursive: true })
})

test("resolveAgent produces orbctl command without -- flag", async () => {
  const stateDir = await makeTmpDir()
  await writeConfig(stateDir, {
    "vm-x": { id: "vm-x", orbName: "vm-x", agent: "pi", sessionMode: "persistent", registeredAt: "" },
  })

  let capturedResolve: ((p?: string) => { agentCommand: string }) | null = null
  mock.module("acpx/flows", () => ({
    FlowRunner: class {
      constructor(opts: { resolveAgent: (p?: string) => { agentCommand: string } }) {
        capturedResolve = opts.resolveAgent
      }
      async run(_f: unknown, input: Record<string, unknown>) {
        const name = input.name as string
        return { state: { status: "completed", outputs: { register: { id: name, orbName: name, agent: "pi", sessionMode: "persistent", registeredAt: "" } } }, runDir: "" }
      }
    },
  }))

  const { createFleetManager } = await import("./fleet-runner")
  const fleet = createFleetManager({ stateDir, acpxStateDir: stateDir })
  await fleet.provision({ name: "vm-x", telegramToken: "tok" }).catch(() => {})

  expect(capturedResolve).not.toBeNull()
  const cmd = capturedResolve!("vm-x").agentCommand
  expect(cmd).toContain("orbctl run -m vm-x")
  expect(cmd).not.toContain(" -- ")
  expect(cmd).toContain("bash -c")
  await rm(stateDir, { recursive: true })
})
