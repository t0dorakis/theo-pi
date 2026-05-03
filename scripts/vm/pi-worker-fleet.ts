#!/usr/bin/env bun
/**
 * Fleet manager CLI.
 *
 * Usage:
 *   pi-worker-fleet provision <name> <telegram-token> [--agent pi|claude|codex] [--session oneshot|persistent]
 *   pi-worker-fleet status
 *   pi-worker-fleet deprovision <name>
 *   pi-worker-fleet list
 */

import { getRuntimeEnv } from "./lib/env"
import { createFleetManager } from "./lib/fleet-runner"

const env = getRuntimeEnv()
const fleet = createFleetManager({
  stateDir: env.stateDir,
  acpxStateDir: env.acpx.stateDir,
  cwd: process.cwd(),
})

const [cmd, ...args] = process.argv.slice(2)

function usage() {
  console.error([
    "usage:",
    "  pi-worker-fleet provision <name> <telegram-token> [--agent pi] [--session persistent]",
    "  pi-worker-fleet status",
    "  pi-worker-fleet deprovision <name>",
    "  pi-worker-fleet list",
  ].join("\n"))
  process.exit(1)
}

function parseFlags(args: string[]) {
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i]
    } else {
      positional.push(args[i])
    }
  }
  return { flags, positional }
}

switch (cmd) {
  case "provision": {
    const { flags, positional } = parseFlags(args)
    const [name, token] = positional
    if (!name || !token) usage()

    console.log(`Provisioning VM "${name}" with agent "${flags.agent ?? "pi"}"...`)
    const vm = await fleet.provision({
      name,
      telegramToken: token,
      agent: flags.agent,
      sessionMode: flags.session as "oneshot" | "persistent" | undefined,
      allowedChatIds: flags["allowed-chats"],
    })
    console.log("✅ Provisioned:")
    console.log(JSON.stringify(vm, null, 2))
    break
  }

  case "status": {
    const entries = await fleet.status()
    if (entries.length === 0) {
      console.log("No VMs in fleet.")
      break
    }
    const width = Math.max(...entries.map((e) => e.id.length), 4)
    console.log(`${"ID".padEnd(width)}  STATE    AGENT   OK`)
    console.log("-".repeat(width + 20))
    for (const e of entries) {
      const ok = e.ok ? "✅" : "❌"
      console.log(`${e.id.padEnd(width)}  ${e.state.padEnd(8)} ${e.agent.padEnd(7)} ${ok}`)
    }
    break
  }

  case "deprovision": {
    const [name] = args
    if (!name) usage()
    console.log(`Deprovisioning "${name}"...`)
    await fleet.deprovision(name)
    console.log(`✅ Deprovisioned "${name}"`)
    break
  }

  case "list": {
    const vms = await fleet.list()
    console.log(JSON.stringify(vms, null, 2))
    break
  }

  default:
    usage()
}
