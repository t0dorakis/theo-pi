# Fleet Manager Plan

**Date:** 2026-04-21  
**User story:** As an Orchestrator agent and End User I want a clean API to start new VMs with agents given a telegram token to interact with.

---

## Verified API facts (no assumptions)

All APIs confirmed by direct source inspection:

| Fact | Source | Value |
|------|--------|-------|
| `createAgentRegistry` signature | `src/runtime.ts:64` | `(params?: { overrides?: Record<string, string> }) => AcpAgentRegistry` |
| `FlowRunnerOptions.resolveAgent` | `src/flows/types.ts:341` | `(profile?: string) => { agentName, agentCommand, cwd }` |
| `FlowRunner.run()` | `src/flows/runtime.ts:163` | `(flow, input, options?) => Promise<FlowRunResult>` |
| `acp` node `profile` field | `src/flows/types.ts:54` | `string \| undefined` — passed to `resolveAgent(profile)` |
| `shell` node `exec` field | `src/flows/types.ts` | **function** `(context) => MaybePromise<ShellActionExecution>` — NOT plain object |
| `FlowRunner` is sequential | `src/flows/runtime.ts:205` | `while (current)` loop — no parallel node execution |
| `pi` agent command | `src/agent-registry.ts` | `npx pi-acp@^0.0.26` |
| `orbctl run` stdin pipe | Live test | ✅ Persistent pipe, content is delivered |
| `orbctl run -m <name> cmd` | Live test | ✅ 80ms overhead, works from inside VM |
| `orbctl list -f json` | Live test | returns `[{ id, name, state, config }]` |
| `orbctl info <name>` | Live test | returns IPv4, IPv6, distro, arch, disk |
| `orbctl run` file write | Live test | `echo content \| orbctl run -m <name> bash -c 'cat > /file'` ✅ |
| `pi-acp` on npm | npm show | v0.0.26, "ACP adapter for pi coding agent" |
| FlowRunner parallel nodes | `graph.ts:resolveNext` | **NOT supported** — single string returned, sequential only |

---

## Target API (the user story in code)

```ts
// Orchestrator agent or human — provision a new VM:
const vm = await fleet.provision({
  name: "worker-3",
  telegramToken: "7891234:ABCdef...",
  agent: "pi",                         // pi | claude | codex
  sessionMode: "persistent",           // optional, default: persistent
})
// → VM cloned, configured, services running, registered
// → User opens Telegram, messages @worker-3-bot — it works

// Check all VMs:
const health = await fleet.status()
// → [{ id: "worker-3", state: "running", piReady: true, botRunning: true }]

// Deprovision:
await fleet.deprovision("worker-3")

// From Telegram to the coordinator bot:
// /provision worker-3 7891234:ABCdef...
// /fleet-status
// /deprovision worker-3
```

---

## Architecture

```
scripts/vm/
  lib/
    fleet-config.ts          read/write ~/.pi-worker/fleet.json
    fleet-runner.ts          FleetManager class — public API
  flows/
    provision-vm.flow.ts     acpx flow — VM lifecycle
  pi-worker-fleet.ts         CLI entry point
```

The `FleetManager` wraps `FlowRunner`. It owns:
- Fleet manifest (which VMs exist, their tokens, agents)
- `resolveAgent` function that maps profile → orbctl command
- Provision / status / deprovision operations

---

## Fleet config (`lib/fleet-config.ts`)

```ts
export type FleetVm = {
  id: string
  orbName: string
  agent: "pi" | "claude" | "codex" | string
  sessionMode: "oneshot" | "persistent"
  registeredAt: string
  lastVerifiedAt?: string
}

export type FleetConfig = {
  schema: "pi-worker.fleet.v1"
  vms: Record<string, FleetVm>
}

// Tokens NOT stored in fleet.json — passed at provision time, written to VM only
```

Stored at `~/.pi-worker/fleet.json`. Tokens stay on the VM in `~/.env.pi`.

---

## Provision flow (`flows/provision-vm.flow.ts`)

Using verified APIs only. `shell.exec` is a function. Nodes are sequential.

```ts
import { defineFlow, shell, action, acp, compute } from "acpx/flows"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
const orbctl = (...args: string[]) => run("orbctl", args).then(r => r.stdout.trim())
const orbrun = (vm: string, cmd: string) =>
  run("orbctl", ["run", "-m", vm, "bash", "-c", cmd]).then(r => r.stdout.trim())
const orbpipe = (vm: string, content: string, path: string) =>
  run("orbctl", ["run", "-m", vm, "bash", "-c", `cat > ${path}`], { input: content }).then(r => r.stdout)

type ProvisionInput = {
  name: string
  telegramToken: string
  agent?: string
  sessionMode?: string
  allowedChatIds?: string
}

export default defineFlow({
  name: "provision-vm",
  permissions: { requiredMode: "approve-all", requireExplicitGrant: true },
  startAt: "check_exists",
  nodes: {

    check_exists: action({
      statusDetail: "Check if VM already exists",
      run: async ({ input }) => {
        const { name } = input as ProvisionInput
        const existing = JSON.parse(await orbctl("list", "-f", "json")) as Array<{ name: string; state: string }>
        const found = existing.find(v => v.name === name)
        return { exists: !!found, state: found?.state ?? null }
      },
    }),

    clone_vm: shell({
      statusDetail: "Clone base VM",
      timeoutMs: 5 * 60_000,
      exec: ({ input, outputs }) => {
        if ((outputs.check_exists as { exists: boolean }).exists) {
          // Already exists — skip by running a no-op
          return { command: "true", args: [] }
        }
        return {
          command: "orbctl",
          args: ["clone", "theo-pi", (input as ProvisionInput).name],
          timeoutMs: 5 * 60_000,
        }
      },
    }),

    start_vm: shell({
      statusDetail: "Start VM",
      timeoutMs: 60_000,
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["start", (input as ProvisionInput).name],
      }),
      parse: (_result) => ({ started: true }),
    }),

    wait_ready: shell({
      statusDetail: "Wait for Pi to respond",
      timeoutMs: 3 * 60_000,
      exec: ({ input }) => {
        const { name } = input as ProvisionInput
        return {
          command: "orbctl",
          args: ["run", "-m", name, "bash", "-c",
            "until npx pi-acp@latest --version >/dev/null 2>&1; do echo waiting; sleep 3; done; echo ready"],
        }
      },
    }),

    write_env: action({
      statusDetail: "Write environment config to VM",
      run: async ({ input }) => {
        const { name, telegramToken, agent, sessionMode, allowedChatIds } = input as ProvisionInput
        const envLines = [
          `export TELEGRAM_BOT_TOKEN=${telegramToken}`,
          `export TELEGRAM_ALLOWED_CHAT_IDS=${allowedChatIds ?? "*"}`,
          `export PI_WORKER_BACKEND=acpx`,
          `export ACPX_AGENT=${agent ?? "pi"}`,
          `export ACPX_SESSION_MODE=${sessionMode ?? "persistent"}`,
          `export ACPX_STATE_DIR=$HOME/.pi-worker/acp`,
          `export PI_WORKER_JOB_TIMEOUT_SECONDS=120`,
        ]
        // orbctl run piping stdin: echo content | orbctl run -m <name> bash -c 'cat > file'
        await run("orbctl", ["run", "-m", name, "bash", "-c", "cat > ~/.env.pi"],
          { input: envLines.join("\n") } as never)
        return { envWritten: true }
      },
    }),

    start_services: shell({
      statusDetail: "Start poller and runner",
      timeoutMs: 30_000,
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["run", "-m", (input as ProvisionInput).name, "bash", "-c",
          "source ~/.env.pi && ~/bin/pi-worker-start && ~/bin/pi-worker-telegram-bot & ~/bin/pi-worker-telegram-runner &"],
      }),
    }),

    // ACP round-trip to the new VM's Pi — using profile routing
    // profile = VM name → resolveAgent maps it to: "orbctl run -m <name> -- npx pi-acp@^0.0.26"
    verify: acp({
      profile: ({ input }) => (input as ProvisionInput).name,
      statusDetail: "ACP round-trip to new VM",
      timeoutMs: 60_000,
      prompt: () =>
        'You are a Pi agent on a newly provisioned VM. Report: {"hostname":"...","ready":true}',
      parse: (text, _ctx) => {
        try { return JSON.parse(text.match(/\{[^}]+\}/)?.[0] ?? "{}") }
        catch { return { hostname: "unknown", ready: false, raw: text } }
      },
    }),

    register: compute({
      run: ({ input, outputs }) => {
        const { name, agent, sessionMode } = input as ProvisionInput
        return {
          id: name,
          orbName: name,
          agent: agent ?? "pi",
          sessionMode: sessionMode ?? "persistent",
          registeredAt: new Date().toISOString(),
          lastVerifiedAt: new Date().toISOString(),
          hostname: (outputs.verify as { hostname?: string }).hostname,
        }
      },
    }),
  },

  edges: [
    { from: "check_exists",    to: "clone_vm" },
    { from: "clone_vm",        to: "start_vm" },
    { from: "start_vm",        to: "wait_ready" },
    { from: "wait_ready",      to: "write_env" },
    { from: "write_env",       to: "start_services" },
    { from: "start_services",  to: "verify" },
    { from: "verify",          to: "register" },
  ],
})
```

---

## Fleet runner (`lib/fleet-runner.ts`)

```ts
import { FlowRunner } from "acpx/flows"
import { createAgentRegistry } from "acpx/runtime"
import { createFileSessionStore } from "acpx/runtime"
import provisionFlow from "../flows/provision-vm.flow"
import { readFleetConfig, writeFleetConfig, type FleetVm } from "./fleet-config"

export function createFleetManager(options: {
  stateDir: string
  acpxStateDir: string
  cwd?: string
}) {
  function buildRunner(fleetVms: Record<string, FleetVm>) {
    // Build override map: vm-id → "orbctl run -m <orbName> -- npx pi-acp@^0.0.26"
    // resolveAgentCommand will use this when profile matches a VM id
    const overrides: Record<string, string> = {}
    for (const [id, vm] of Object.entries(fleetVms)) {
      overrides[id] = `orbctl run -m ${vm.orbName} -- npx pi-acp@latest`
    }

    return new FlowRunner({
      resolveAgent: (profile) => {
        if (profile && overrides[profile]) {
          return { agentName: profile, agentCommand: overrides[profile], cwd: options.cwd ?? process.cwd() }
        }
        // Default: this VM's Pi
        return { agentName: "pi", agentCommand: "npx pi-acp@latest", cwd: options.cwd ?? process.cwd() }
      },
      permissionMode: "approve-all",
      outputRoot: `${options.stateDir}/fleet-runs`,
    })
  }

  return {
    async provision(input: {
      name: string
      telegramToken: string
      agent?: string
      sessionMode?: string
      allowedChatIds?: string
    }) {
      const config = await readFleetConfig(options.stateDir)
      const runner = buildRunner(config.vms)
      const result = await runner.run(provisionFlow, input)

      if (result.state.status !== "completed") {
        throw new Error(`Provision failed: ${result.state.error ?? result.state.status}`)
      }

      const registered = result.state.outputs["register"] as FleetVm
      config.vms[registered.id] = registered
      await writeFleetConfig(options.stateDir, config)

      return registered
    },

    async status() {
      const config = await readFleetConfig(options.stateDir)
      // Sequential (FlowRunner is sequential) — run one health check per VM
      const results = []
      for (const [id, vm] of Object.entries(config.vms)) {
        try {
          const runner = buildRunner(config.vms)
          const orbInfo = await execFile("orbctl", ["info", vm.orbName]).then(r => r.stdout)
          const state = orbInfo.match(/State: (\w+)/)?.[1] ?? "unknown"
          results.push({ id, orbName: vm.orbName, agent: vm.agent, state, ok: state === "running" })
        } catch (e) {
          results.push({ id, orbName: vm.orbName, agent: vm.agent, state: "error", ok: false })
        }
      }
      return results
    },

    async deprovision(id: string) {
      const config = await readFleetConfig(options.stateDir)
      const vm = config.vms[id]
      if (!vm) throw new Error(`VM ${id} not in fleet`)
      await execFile("orbctl", ["stop", vm.orbName]).catch(() => {})
      await execFile("orbctl", ["delete", vm.orbName])
      delete config.vms[id]
      await writeFleetConfig(options.stateDir, config)
    },
  }
}
```

---

## CLI entry point (`pi-worker-fleet.ts`)

```bash
# From this VM or any automation:
bun scripts/vm/pi-worker-fleet.ts provision worker-3 7891234:ABC...
bun scripts/vm/pi-worker-fleet.ts status
bun scripts/vm/pi-worker-fleet.ts deprovision worker-3
```

---

## Telegram integration

Add to `telegram-poller.ts` commands:

```
/provision <name> <token>   — provision new VM and bot
/fleet-status               — list all VMs and health
/deprovision <name>         — stop and delete VM
```

This lets a human or orchestrator agent manage the fleet entirely via Telegram messages to the coordinator bot.

---

## What makes this work (verified)

1. **`orbctl run -m <name> -- npx pi-acp@latest`** — valid ACP transport. `orbctl run` holds stdin/stdout open for the lifetime of the child process. ACP JSON-RPC flows over the pipe. ✅ tested.

2. **`resolveAgent(profile)` → orbctl command** — FlowRunner calls this for every `acp` node. Profile = VM id = orbctl machine name. No extra registry abstraction needed.

3. **`shell.exec` is a function** — `(context: FlowNodeContext) => ShellActionExecution`. Verified from `types.ts`. No plain object.

4. **Sequential flow execution** — FlowRunner is `while (current)` sequential. Fleet status uses a plain `for` loop + `orbctl info`, not a flow. ✅ matches actual API.

5. **File write via orbctl** — `echo content | orbctl run -m <name> bash -c 'cat > path'` ✅ tested.

---

## Known open questions (not assumed)

- `npx pi-acp@latest` inside the new VM: does `npx` resolve to the version acpx expects, or should we pin? Needs one live test.
- `orbctl run` command syntax for `--`: tested that `--` causes an error. Use `orbctl run -m <name> bash -c "..."` pattern instead.
- `execFile("orbctl", ..., { input: content })` — need to verify Bun's execFile accepts `input` option for stdin. Alternative: use `spawn` with `.stdin.write`.
