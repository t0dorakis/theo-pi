# PR5: FlowRunner integration with Telegram checkpoint gates

**Branch:** `feat/pr5-acpx-flows`  
**Status:** pending  
**Depends on:** PR1, PR3, PR4  
**Estimated scope:** ~500 LOC new, ~150 LOC changed

---

## Why

Structured multi-step tasks — "diagnose failing tests, fix them, run them, then open a PR" — cannot be expressed as a single Telegram prompt reliably. They need:

1. Defined step sequence (which agent runs which task in which order)
2. Checkpoint gates (pause and ask the human before destructive actions)
3. Auditable per-step records (which step failed and why)
4. Composable outputs (step 3 receives step 2's result as input)

`FlowRunner` from `acpx/flows` provides all of this. It manages session lifecycle, trace emission, per-step timeouts, conditional edges, and the `FlowRunStore` bundle format. We integrate it directly rather than reimplementing any of it.

The Telegram integration adds: `/flow <name>` trigger, live status updates during runs (via PR2 streaming), and approval replies for checkpoint nodes.

---

## Architecture Overview

```
pi-worker-flow-run.ts          new entry point — runs a named flow
  └── FlowRunner.run()         acpx FlowRunner — manages all node execution
        ├── acp nodes          → AcpRuntime sessions (Pi, Claude, etc.)
        ├── shell nodes        → local shell execution
        ├── compute nodes      → pure TypeScript functions
        └── checkpoint nodes   → write live.json "waiting" state
                                 → telegram poller detects → sends approval message
                                 → user replies /continue or /abort
                                 → flow resumes or cancels

telegram-poller.ts
  ├── /flow <name>             → submits FlowJob to queue
  ├── /continue <runId>        → resumes waiting flow
  └── /abort <runId>           → cancels waiting flow

flow-registry.ts               maps name → file path
flows/                         named flow definitions
  diagnose-and-fix.flow.ts
  pr-review.flow.ts
```

---

## New File: `scripts/vm/flows/flow-registry.ts`

```ts
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export type FlowRegistryEntry = {
  name: string
  path: string          // absolute path to the .flow.ts file
  description?: string
}

export type FlowRegistry = {
  lookup(name: string): FlowRegistryEntry | undefined
  list(): FlowRegistryEntry[]
}

export function createFlowRegistry(options: {
  flowsDir: string
  registryFile: string   // ~/.pi-worker/flows.json
}): FlowRegistry {
  // Loads ~/.pi-worker/flows.json on each call (no caching — allows live updates)
  // Format: [{ "name": "diagnose-and-fix", "path": "~/flows/diagnose-and-fix.flow.ts", "description": "..." }]

  let builtinEntries: FlowRegistryEntry[] = []

  // Built-in flows are in <flowsDir>/*.flow.ts
  // On startup, scan the directory and add any .flow.ts files found
  async function loadBuiltins(): Promise<FlowRegistryEntry[]> {
    const { readdir } = await import("node:fs/promises")
    const files = await readdir(options.flowsDir).catch(() => [] as string[])
    return files
      .filter((f) => f.endsWith(".flow.ts"))
      .map((f) => ({
        name: f.replace(".flow.ts", ""),
        path: join(options.flowsDir, f),
      }))
  }

  async function loadUserRegistry(): Promise<FlowRegistryEntry[]> {
    try {
      const content = await readFile(options.registryFile, "utf8")
      return JSON.parse(content) as FlowRegistryEntry[]
    } catch {
      return []
    }
  }

  return {
    async lookup(name: string) {
      const all = [...(await loadBuiltins()), ...(await loadUserRegistry())]
      return all.find((e) => e.name === name)
    },
    async list() {
      return [...(await loadBuiltins()), ...(await loadUserRegistry())]
    },
  } as unknown as FlowRegistry // cast: async methods satisfy synchronous interface via dynamic dispatch
}
```

Env var: `PI_WORKER_FLOWS_DIR` (default `scripts/vm/flows`). Add to `env.ts`:

```ts
flowsDir: process.env.PI_WORKER_FLOWS_DIR ?? join(scriptDir, "flows"),
flowRegistryFile: process.env.PI_WORKER_FLOWS_REGISTRY ?? join(homeDir, ".pi-worker", "flows.json"),
```

---

## New File: `scripts/vm/pi-worker-flow-run.ts`

Entry point for running a named flow. Can be invoked directly (`bun pi-worker-flow-run.ts diagnose-and-fix '{"task":"..."}'`) or by the job queue:

```ts
#!/usr/bin/env bun
import { FlowRunner } from "acpx/flows"
import { resolveAgentCommand } from "acpx/runtime"

const env = getRuntimeEnv()
const flowName = process.argv[2]
const inputJson = process.argv[3] ?? "{}"

if (!flowName) {
  console.error("usage: pi-worker-flow-run <flowName> [inputJson]")
  process.exit(1)
}

const registry = createFlowRegistry({
  flowsDir: env.flowsDir,
  registryFile: env.flowRegistryFile,
})

const entry = await registry.lookup(flowName)
if (!entry) {
  console.error(`unknown flow: ${flowName}`)
  process.exit(1)
}

// Dynamically import the flow definition
const mod = await import(entry.path)
const flowDef = mod.default ?? mod.flow

const runner = new FlowRunner({
  resolveAgent: (profile) => ({
    agentName: profile ?? env.acpx.agent,
    agentCommand: resolveAgentCommand(profile ?? env.acpx.agent),
    cwd: env.acpx.cwd ?? process.cwd(),
  }),
  permissionMode: "approve-all",
  timeoutMs: env.jobTimeoutSeconds * 1000,
  outputRoot: join(env.stateDir, "flow-runs"),  // store bundles under our stateDir
})

const input = JSON.parse(inputJson)

console.log(JSON.stringify({ ok: true, starting: flowName, input }))

const result = await runner.run(flowDef, {
  input,
  run: { title: `${flowName} (telegram)` },
})

console.log(JSON.stringify({
  ok: result.state.status === "completed",
  runId: result.state.runId,
  status: result.state.status,
  runDir: result.runDir,
  outputs: result.state.outputs,
}))
process.exit(result.state.status === "completed" ? 0 : 1)
```

---

## Checkpoint Wiring

Checkpoint nodes pause flow execution. We wire them to Telegram via `live.json`.

### Checkpoint Node Pattern

In a flow definition, a checkpoint node that needs Telegram approval:

```ts
// flows/diagnose-and-fix.flow.ts
import { defineFlow, acp, checkpoint, shell } from "acpx/flows"

export default defineFlow({
  nodes: {
    diagnose: acp({
      profile: "pi",
      prompt: ({ input }) => `Diagnose the failing tests in ${input.repoPath}. Output a JSON plan.`,
      parse: (text) => JSON.parse(text),
    }),

    "review-plan": checkpoint({
      summary: "Review the diagnosis plan before applying fixes",
      run: async ({ outputs }) => {
        // Write approval request to a well-known file that the telegram poller watches
        const approvalRequest = {
          nodeId: "review-plan",
          summary: "Review the diagnosis plan before applying fixes",
          data: outputs.diagnose,
        }
        // This file is watched by pi-worker-telegram-bot's checkpoint poller
        await writeFile(
          join(process.env.PI_WORKER_STATE_DIR!, "flow-runs", process.env.PI_FLOW_RUN_ID!, "checkpoint-request.json"),
          JSON.stringify(approvalRequest, null, 2),
        )
        // Block until the file is replaced with a checkpoint-response.json by the telegram poller
        await waitForApproval(process.env.PI_FLOW_RUN_ID!, 30 * 60_000)
      },
    }),

    fix: acp({
      profile: "pi",
      prompt: ({ outputs }) => `Apply these fixes: ${JSON.stringify(outputs.diagnose)}`,
    }),

    verify: shell({
      exec: () => ({ command: "npm", args: ["test"], cwd: process.env.PI_WORKER_CWD }),
    }),
  },
  edges: [
    { from: "diagnose", to: "review-plan" },
    { from: "review-plan", to: "fix" },
    { from: "fix", to: "verify" },
  ],
})
```

### Telegram Poller: Checkpoint Detection

`pi-worker-telegram-bot.ts` polls an in-flight flow's `live.json` projection. When it detects `waitingOn: "telegram:<chatId>"`, it sends an approval message:

```ts
// New in telegram-poller.ts: per-run checkpoint watcher
async function watchActiveFlowRuns() {
  const flowRunsDir = join(env.stateDir, "flow-runs")
  const entries = await readdir(flowRunsDir).catch(() => [] as string[])
  for (const runId of entries) {
    const livePath = join(flowRunsDir, runId, "projections", "live.json")
    const live = await readFile(livePath, "utf8").then(JSON.parse).catch(() => null)
    if (!live || live.waitingOn?.startsWith("telegram:") !== true) continue

    const chatId = Number(live.waitingOn.split(":")[1])
    if (!telegram.isAllowed(chatId)) continue

    const checkpointReqPath = join(flowRunsDir, runId, "checkpoint-request.json")
    const req = await readFile(checkpointReqPath, "utf8").then(JSON.parse).catch(() => null)
    if (!req) continue

    // Check if we already sent an approval request for this checkpoint
    const sentPath = join(flowRunsDir, runId, "checkpoint-notified.json")
    const alreadySent = await readFile(sentPath, "utf8").catch(() => null)
    if (alreadySent) continue

    const summary = req.summary ?? "Flow paused at checkpoint"
    const preview = JSON.stringify(req.data ?? {}, null, 2).slice(0, 800)

    await telegram.sendMessage(
      chatId,
      `✋ *Flow paused*: ${summary}\n\n\`\`\`\n${preview}\n\`\`\`\n\nReply:\n/continue ${runId}\n/abort ${runId}`,
      { parse_mode: "Markdown" },
    )
    await writeFile(sentPath, JSON.stringify({ notifiedAt: nowIso() }))
  }
}
```

The checkpoint watcher runs on each Telegram poll cycle (every `pollIntervalMs`).

### `/continue` and `/abort` Commands

```ts
if (textValue.startsWith("/continue ")) {
  const runId = textValue.slice(10).trim()
  const responsePath = join(env.stateDir, "flow-runs", runId, "checkpoint-response.json")
  await writeFile(responsePath, JSON.stringify({ approved: true, at: nowIso(), by: String(chatId) }))
  await telegram.sendMessage(chatId, `▶️ Continuing flow run \`${runId}\``, { parse_mode: "Markdown" })
  return { ok: true }
}

if (textValue.startsWith("/abort ")) {
  const runId = textValue.slice(7).trim()
  const responsePath = join(env.stateDir, "flow-runs", runId, "checkpoint-response.json")
  await writeFile(responsePath, JSON.stringify({ approved: false, at: nowIso(), by: String(chatId) }))
  await telegram.sendMessage(chatId, `🛑 Aborting flow run \`${runId}\``, { parse_mode: "Markdown" })
  return { ok: true }
}
```

The `waitForApproval` helper in the checkpoint node polls for `checkpoint-response.json`:

```ts
async function waitForApproval(runId: string, timeoutMs: number): Promise<void> {
  const responsePath = join(process.env.PI_WORKER_STATE_DIR!, "flow-runs", runId, "checkpoint-response.json")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await readFile(responsePath, "utf8").then(JSON.parse).catch(() => null)
    if (response?.approved === true) return
    if (response?.approved === false) throw new Error("flow aborted by user")
    await sleep(3000)
  }
  throw new Error(`checkpoint approval timeout after ${timeoutMs / 60000} minutes`)
}
```

---

## Telegram Trigger: `/flow` Command

In `telegram-poller.ts`:

```ts
if (textValue.startsWith("/flow ")) {
  const parts = textValue.slice(6).trim().split(/\s+--input\s+/)
  const flowName = parts[0].trim()
  const inputJson = parts[1]?.trim() ?? "{}"

  const entry = await registry.lookup(flowName)
  if (!entry) {
    await telegram.sendMessage(chatId, `Unknown flow: \`${flowName}\`. Use /flows to list available flows.`, { parse_mode: "Markdown" })
    return { ok: true }
  }

  // Run flow in background, send initial acknowledgement
  const runId = crypto.randomUUID()
  await telegram.sendMessage(chatId, `🚀 Starting flow \`${flowName}\` (run: \`${runId}\`)`, { parse_mode: "Markdown" })

  // Fire and forget — flow runs in subprocess to avoid blocking the poll loop
  const proc = Bun.spawn(
    ["bun", localScript(scriptDir, "pi-worker-flow-run"), flowName, inputJson],
    {
      env: { ...process.env, PI_FLOW_RUN_ID: runId, PI_FLOW_CHAT_ID: String(chatId) },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  // Completion notification sent when the subprocess exits (fire-forget monitor)
  monitorFlowProcess(proc, runId, chatId)
  return { ok: true }
}

if (textValue === "/flows") {
  const entries = await registry.list()
  const lines = entries.map((e) => `• \`${e.name}\`${e.description ? ` — ${e.description}` : ""}`)
  await telegram.sendMessage(chatId, "Available flows:\n" + lines.join("\n"), { parse_mode: "Markdown" })
  return { ok: true }
}
```

---

## Flow Completion Notification

```ts
async function monitorFlowProcess(proc: Bun.Subprocess, runId: string, chatId: number) {
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const result = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as {
    ok: boolean; status: string; outputs?: Record<string, unknown>
  }

  if (result.ok) {
    const outputSummary = Object.entries(result.outputs ?? {})
      .map(([k, v]) => `*${k}*: ${String(v).slice(0, 200)}`)
      .join("\n")
    await telegram.sendMessage(chatId, `✅ Flow completed\n\n${outputSummary || "(no outputs)"}`, { parse_mode: "Markdown" })
  } else {
    await telegram.sendMessage(chatId, `❌ Flow failed (status: \`${result.status}\`).\n\nRun ID: \`${runId}\``, { parse_mode: "Markdown" })
  }
}
```

---

## Example Flows

### `scripts/vm/flows/diagnose-and-fix.flow.ts`

Nodes: `diagnose` (acp/pi) → `review-plan` (checkpoint) → `fix` (acp/pi) → `verify` (shell: `npm test`).

Input: `{ repoPath: string, task: string }`.  
Output: `{ fixSummary: string, testResult: string }`.

### `scripts/vm/flows/pr-review.flow.ts`

Nodes: `diff` (shell: `git diff main`) → `review` (acp/pi) → `summarise` (compute) → `post-comment` (action: GitHub API).

Input: `{ prUrl: string, repo: string }`.  
Output: `{ reviewComment: string, verdict: "approve" | "request-changes" }`.

---

## Approval Timeout

Env var: `PI_WORKER_FLOW_APPROVE_TIMEOUT_MINUTES` (default: 30). If the user does not reply `/continue` or `/abort` within this time, `waitForApproval` throws, the checkpoint node fails, and the flow is marked `failed`. A Telegram message is sent explaining the timeout.

---

## Task Checklist

- [ ] Add `flowsDir`, `flowRegistryFile` to `env.ts` + `getRuntimeEnv()`
- [ ] Create `scripts/vm/flows/flow-registry.ts`
- [ ] Create `scripts/vm/pi-worker-flow-run.ts`
- [ ] Create `scripts/vm/flows/diagnose-and-fix.flow.ts`
- [ ] Create `scripts/vm/flows/pr-review.flow.ts`
- [ ] Add `/flow`, `/flows`, `/continue`, `/abort` commands to `telegram-poller.ts`
- [ ] Add checkpoint watcher to `pi-worker-telegram-bot.ts` poll loop
- [ ] Add `monitorFlowProcess` helper
- [ ] Update help text
- [ ] Write unit tests
- [ ] Manual test: `/flow diagnose-and-fix {"task":"fix ts errors"}` produces checkpoint approval message

---

## Test Strategy

**Test 1 — flow registry lookup:**  
`registry.lookup("diagnose-and-fix")` returns entry with correct path when the `.flow.ts` file exists.

**Test 2 — checkpoint detection:**  
Mock `live.json` with `waitingOn: "telegram:12345"`. Checkpoint watcher sends approval message to chatId 12345 with correct summary text.

**Test 3 — continue command:**  
`/continue <runId>` writes `checkpoint-response.json` with `approved: true`.

**Test 4 — abort command:**  
`/abort <runId>` writes `checkpoint-response.json` with `approved: false`.

**Test 5 — approval timeout:**  
`waitForApproval` called with `timeoutMs: 100`. No response written within 100 ms → throws `"checkpoint approval timeout"`.

**Test 6 — duplicate notification guard:**  
`checkpoint-notified.json` already exists → watcher does NOT send a second Telegram message.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `FlowRunner` internal API evolves between acpx versions | Medium | Pin acpx version; flows use only public `acpx/flows` export — no internal imports |
| `waitForApproval` busy-polls every 3 seconds — blocks flow thread | Low | Acceptable for typical human response times; future optimization: use `fs.watch` |
| Flow subprocess orphaned if telegram-bot process restarts mid-flow | Medium | `checkpoint-request.json` persists on disk; on next bot startup, checkpoint watcher detects and re-sends approval message |
| Multiple concurrent `/flow` invocations overwhelm resources | Low | Document: one concurrent flow per chat recommended; no hard enforcement in v1 |
| `PI_FLOW_RUN_ID` env var not threaded correctly into checkpoint node | Medium | Add integration test that verifies env var is set; checkpoint node reads it at runtime |

---

## Definition of Done

- `/flow diagnose-and-fix '{"task":"describe the repo"}'` sent in Telegram:
  - Bot responds with run ID
  - Bot sends checkpoint approval message when the checkpoint node is reached
  - `/continue <runId>` causes flow to resume and complete
  - Bot sends final `✅ Flow completed` message with outputs
- `/flows` lists all built-in flows with descriptions.
- `/abort <runId>` causes the flow to fail with a clear message.
- All 6 unit tests pass.
- `FlowRunner` output bundle (`flow-runs/<runId>/manifest.json`) is created for every run.
