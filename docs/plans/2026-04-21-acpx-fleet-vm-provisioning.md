# Fleet VM Provisioning via acpx Flows

**Date:** 2026-04-21  
**Status:** Proposal  
**Branch:** feat/fleet-vm-provisioning (new, independent)

---

## Key discovery

`orbctl` is available **inside** the OrbStack VM at `/opt/orbstack-guest/bin/orbctl`.

From inside this VM we can:
```bash
orbctl list                           # list all VMs
orbctl clone theo-pi <new-name>       # clone this VM (with Pi pre-installed)
orbctl create ubuntu:noble <name>     # create a fresh VM
orbctl run -m <name> <command>        # run command on any VM
orbctl start/stop/delete <name>       # lifecycle management
```

`orbctl clone` is the unlock: it creates an exact snapshot of this VM — Pi installed, config in place, acpx ready. New VM is ready for configuration in seconds, not minutes.

---

## The acpx leverage: profile-based multi-VM routing

acpx `acp` nodes have a `profile` field. `FlowRunner` accepts a `resolveAgent(profile?)` function that maps profile names to agent commands.

```ts
const runner = new FlowRunner({
  resolveAgent: (profile) => {
    if (profile && fleetConfig.vms[profile]) {
      const vm = fleetConfig.vms[profile]
      return {
        agentName: vm.agent,
        agentCommand: `orbctl run -m ${vm.orbName} pi-acp`,
        cwd: vm.cwd ?? "/root/workspaces/theo-pi",
      }
    }
    // default: this VM
    return { agentName: "pi", agentCommand: "pi-acp", cwd: process.cwd() }
  },
  permissionMode: "approve-all",
})
```

This means **a single flow can span multiple VMs** — `acp` nodes target different machines by profile, `shell` nodes use `orbctl run -m` to execute on specific VMs. The flow runtime, trace, and session management stay on this coordinator VM.

---

## What to build

### 1. Fleet config (`scripts/vm/lib/fleet-config.ts`)

Single source of truth for all VMs:

```ts
export type VmEntry = {
  id: string
  orbName: string           // orbctl machine name
  agent: string             // "pi" | "claude" | "codex"
  telegramToken: string     // bot token (from env, not stored plaintext)
  sessionMode: "oneshot" | "persistent"
  cwd?: string
  tags?: string[]           // "production" | "test" | "codex-worker"
}

export type FleetConfig = {
  vms: Record<string, VmEntry>  // keyed by id
}
```

Stored at `~/.pi-worker/fleet.json` (tokens as env var refs: `$TELEGRAM_TOKEN_VM1`).

---

### 2. Fleet agent registry (`scripts/vm/lib/fleet-agent-registry.ts`)

Builds an acpx `AgentRegistry` from fleet config:

```ts
export function createFleetAgentRegistry(config: FleetConfig): AcpAgentRegistry {
  const overrides: Record<string, string> = {}
  for (const [id, vm] of Object.entries(config.vms)) {
    // Routes acp profile "vm-id" → orbctl run on that VM
    overrides[id] = `orbctl run -m ${vm.orbName} -- pi-acp`
  }
  return createAgentRegistry({ overrides })
}
```

---

### 3. Provision flow (`scripts/vm/flows/provision-vm.flow.ts`)

```ts
export default defineFlow({
  name: "provision-vm",
  permissions: { requiredMode: "approve-all", requireExplicitGrant: true },
  startAt: "clone",
  nodes: {

    clone: shell({
      statusDetail: "Clone base VM snapshot",
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["clone", "theo-pi", (input as { vmName: string }).vmName],
        timeoutMs: 5 * 60_000,
      }),
    }),

    start: shell({
      statusDetail: "Start new VM",
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["start", (input as { vmName: string }).vmName],
        timeoutMs: 60_000,
      }),
    }),

    wait_ready: shell({
      statusDetail: "Wait for Pi to be reachable",
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["run", "-m", (input as { vmName: string }).vmName, "--",
               "bash", "-c", "until pi --version >/dev/null 2>&1; do sleep 2; done; echo ready"],
        timeoutMs: 3 * 60_000,
      }),
    }),

    write_env: action({
      statusDetail: "Write environment config to new VM",
      run: async ({ input }) => {
        const { vmName, telegramToken, acpxAgent, sessionMode } = input as FlowInput
        const envContent = [
          `export TELEGRAM_BOT_TOKEN=${telegramToken}`,
          `export TELEGRAM_ALLOWED_CHAT_IDS=$TELEGRAM_ALLOWED_CHAT_IDS`,
          `export PI_WORKER_BACKEND=acpx`,
          `export ACPX_AGENT=${acpxAgent ?? "pi"}`,
          `export ACPX_SESSION_MODE=${sessionMode ?? "persistent"}`,
        ].join("\n")

        // Write env file via orbctl run
        await execa("orbctl", ["run", "-m", vmName, "--",
          "bash", "-c", `cat > ~/.env.pi << 'ENVEOF'\n${envContent}\nENVEOF`])
      },
    }),

    start_services: shell({
      statusDetail: "Start poller + runner on new VM",
      exec: ({ input }) => ({
        command: "orbctl",
        args: ["run", "-m", (input as { vmName: string }).vmName, "--",
               "bash", "-c", "source ~/.env.pi && ~/bin/pi-worker-start"],
        timeoutMs: 30_000,
      }),
    }),

    verify: acp({
      // profile routes to the NEW VM's Pi via orbctl run
      profile: ({ input }) => (input as { vmName: string }).vmName,
      statusDetail: "Verify new VM's Pi is alive and responding",
      prompt: () => [
        "You are a Pi agent on a newly provisioned VM.",
        "Report: your hostname, Pi version, and confirm you can read files in the current directory.",
        'Return exactly: { "hostname": "...", "piVersion": "...", "ready": true }',
      ].join("\n"),
      parse: (text) => extractJsonObject(text),
      timeoutMs: 60_000,
    }),

    register: compute({
      run: ({ input, outputs }) => {
        const { vmName, telegramToken, acpxAgent } = input as FlowInput
        return {
          id: vmName,
          orbName: vmName,
          agent: acpxAgent ?? "pi",
          telegramToken,
          sessionMode: "persistent",
          verifiedAt: new Date().toISOString(),
          hostname: (outputs.verify as { hostname?: string }).hostname,
        }
      },
    }),
  },

  edges: [
    { from: "clone", to: "start" },
    { from: "start", to: "wait_ready" },
    { from: "wait_ready", to: "write_env" },
    { from: "write_env", to: "start_services" },
    { from: "start_services", to: "verify" },
    { from: "verify", to: "register" },
  ],
})
```

The `verify` node speaks directly to the new VM's Pi via ACP — no SSH scraping, no polling, no XML markers. Pi on the new VM receives the prompt over ACP, responds, and the flow captures the typed result.

---

### 4. Fleet health flow (`scripts/vm/flows/fleet-health.flow.ts`)

```ts
// Check all VMs simultaneously — one acp node per VM, different profiles
export function buildFleetHealthFlow(vmIds: string[]) {
  const nodes: Record<string, FlowNodeDefinition> = {}
  const edges: FlowEdge[] = []

  for (const id of vmIds) {
    nodes[`check_${id}`] = acp({
      profile: id,
      prompt: () => 'Report health: { "ok": true, "hostname": "...", "load": 0.0 }',
      parse: (text) => extractJsonObject(text),
      timeoutMs: 30_000,
    })
    edges.push({ from: "start", to: `check_${id}` })
    edges.push({ from: `check_${id}`, to: "aggregate" })
  }

  nodes["start"] = compute({ run: () => ({ started: true }) })
  nodes["aggregate"] = compute({
    run: ({ outputs }) => Object.fromEntries(
      vmIds.map(id => [id, outputs[`check_${id}`]])
    ),
  })

  return defineFlow({ name: "fleet-health", startAt: "start", nodes, edges })
}
```

---

### 5. CLI entry point (`scripts/vm/pi-worker-fleet.ts`)

```bash
pi-worker-fleet status                    # health check all VMs
pi-worker-fleet provision <name> <token>  # provision new VM
pi-worker-fleet sync --all                # deploy code to all VMs
pi-worker-fleet delete <name>             # delete a VM (checkpoint gate)
pi-worker-fleet logs <name>               # tail logs from specific VM
```

All powered by `FlowRunner` with the fleet agent registry.

---

## acpx features used

| Feature | How |
|---|---|
| `shell` node | `orbctl clone`, `orbctl run`, SSH commands |
| `action` node | Write env files, parse results, register in fleet |
| `acp` node with `profile` | Route to specific VM's Pi agent |
| `FlowRunner.resolveAgent` | Maps VM id → `orbctl run -m <name> pi-acp` |
| `compute` node | Aggregate health results, build fleet entry |
| `checkpoint` node | Pause before destructive ops (delete, overwrite) |
| `FlowRunStore` | Full provisioning audit trail + replay |
| `extractJsonObject` | Parse Pi's structured health reports |

---

## What this enables

- **Provision a new VM in one command** from inside this VM
- **Verify it via ACP** — not scraping, not polling, typed response from the new Pi
- **Fleet health in one flow** — all VMs checked in parallel, one structured result
- **Full audit trail** — every provisioning step recorded in `FlowRunStore`
- **Idempotent** — clone from a known-good base, same config every time

## Dependencies

- PR #17 (acpx backend) — for `acpx/runtime`
- PR #18 (poller/runner split) — for per-VM service management  
- Independent of PR #3 (run bundles), PR #5 (flows) — but uses same `FlowRunner`
