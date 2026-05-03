/**
 * FleetManager — public API for provisioning and managing worker VMs.
 *
 * User story: As an Orchestrator agent and End User I want a clean API
 * to start new VMs with agents given a telegram token to interact with.
 *
 * Usage:
 *   const fleet = createFleetManager({ stateDir: env.stateDir, acpxStateDir: env.acpx.stateDir })
 *   await fleet.provision({ name: "worker-3", telegramToken: "...", agent: "pi" })
 *   await fleet.status()
 *   await fleet.deprovision("worker-3")
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { FlowRunner } from "acpx/flows"
import { createFileSessionStore } from "acpx/runtime"
import { createProvisionFlow, type ProvisionInput } from "../flows/provision-vm.flow"
import { readFleetConfig, writeFleetConfig, type FleetConfig, type FleetVm } from "./fleet-config"

// Fix Bug 4: execFile imported and promisified
const execAsync = promisify(execFile)

export type FleetManagerOptions = {
  stateDir: string
  acpxStateDir: string
  cwd?: string
}

export type FleetStatusEntry = {
  id: string
  orbName: string
  agent: string
  state: string
  ok: boolean
  hostname?: string
}

export function createFleetManager(options: FleetManagerOptions) {
  function buildRunner(vms: FleetConfig["vms"]): FlowRunner {
    return new FlowRunner({
      resolveAgent: (profile) => {
        if (profile && vms[profile]) {
          const vm = vms[profile]
          return {
            agentName: profile,
            // Fix Bug 3: no -- flag. Use bash -c pattern.
            agentCommand: `orbctl run -m ${vm.orbName} bash -c 'npx pi-acp@^0.0.26'`,
            cwd: options.cwd ?? process.cwd(),
          }
        }
        // Default: this VM's Pi
        return {
          agentName: "pi",
          agentCommand: "npx pi-acp@^0.0.26",
          cwd: options.cwd ?? process.cwd(),
        }
      },
      permissionMode: "approve-all",
      outputRoot: `${options.stateDir}/fleet-runs`,
    })
  }

  return {
    /**
     * Provision a new VM and start a Telegram bot on it.
     * Returns the registered fleet entry when done.
     */
    async provision(input: ProvisionInput): Promise<FleetVm> {
      const config = await readFleetConfig(options.stateDir)
      const runner = buildRunner(config.vms)

      // Factory pattern: vmName baked into flow so acp.profile is a plain string
      const flow = createProvisionFlow(input.name)
      const result = await runner.run(flow, input)

      if (result.state.status !== "completed") {
        throw new Error(
          `Provision of "${input.name}" failed at node "${result.state.currentNode}": ${result.state.error ?? result.state.status}`,
        )
      }

      const registered = result.state.outputs["register"] as FleetVm
      config.vms[registered.id] = registered
      await writeFleetConfig(options.stateDir, config)

      return registered
    },

    /** Check the state of all registered VMs. */
    async status(): Promise<FleetStatusEntry[]> {
      const config = await readFleetConfig(options.stateDir)
      const entries: FleetStatusEntry[] = []

      for (const [id, vm] of Object.entries(config.vms)) {
        try {
          const { stdout } = await execAsync("orbctl", ["info", vm.orbName])
          const state = stdout.match(/State:\s+(\w+)/)?.[1] ?? "unknown"
          entries.push({ id, orbName: vm.orbName, agent: vm.agent, state, ok: state === "running", hostname: vm.hostname })
        } catch {
          entries.push({ id, orbName: vm.orbName, agent: vm.agent, state: "error", ok: false })
        }
      }

      return entries
    },

    /** Stop and delete a VM, remove from fleet. */
    async deprovision(id: string): Promise<void> {
      const config = await readFleetConfig(options.stateDir)
      const vm = config.vms[id]
      if (!vm) throw new Error(`VM "${id}" not found in fleet`)

      await execAsync("orbctl", ["stop", vm.orbName]).catch(() => {})
      await execAsync("orbctl", ["delete", vm.orbName])

      delete config.vms[id]
      await writeFleetConfig(options.stateDir, config)
    },

    /** List all VMs in the fleet manifest. */
    async list(): Promise<FleetVm[]> {
      const config = await readFleetConfig(options.stateDir)
      return Object.values(config.vms)
    },
  }
}
