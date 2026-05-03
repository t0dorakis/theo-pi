import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

export type FleetVm = {
  id: string
  orbName: string
  agent: string
  sessionMode: "oneshot" | "persistent"
  registeredAt: string
  lastVerifiedAt?: string
  hostname?: string
}

export type FleetConfig = {
  schema: "pi-worker.fleet.v1"
  vms: Record<string, FleetVm>
}

function fleetPath(stateDir: string): string {
  return join(stateDir, "fleet.json")
}

export async function readFleetConfig(stateDir: string): Promise<FleetConfig> {
  try {
    const raw = await readFile(fleetPath(stateDir), "utf8")
    return JSON.parse(raw) as FleetConfig
  } catch {
    return { schema: "pi-worker.fleet.v1", vms: {} }
  }
}

export async function writeFleetConfig(stateDir: string, config: FleetConfig): Promise<void> {
  await mkdir(stateDir, { recursive: true })
  await writeFile(fleetPath(stateDir), JSON.stringify(config, null, 2), "utf8")
}
