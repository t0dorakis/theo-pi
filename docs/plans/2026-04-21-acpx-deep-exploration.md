# acpx Deep Exploration: Opportunities for theo-pi

**Date:** 2026-04-21  
**Method:** Full source read of `src/` — runtime, flows, session, output, conformance  
**Short answer:** Yes — one message format for everything. And we can go much further.

---

## The big finding: three stable published APIs

acpx exposes three import paths, each a real published TypeScript API:

```ts
import { ... } from "acpx"            // CLI — spawn process
import { createAcpRuntime } from "acpx/runtime"  // Programmatic — no subprocess
import { FlowRunner, defineFlow } from "acpx/flows"  // Flow orchestration
```

**`acpx/runtime` changes everything.** We do not need to spawn `acpx exec` at all. We can embed the runtime directly in our TypeScript gateway/job-runner and get streaming typed events from any ACP agent in-process. No subprocess, no piping, no `--format quiet`.

---

## The universal event type: `AcpRuntimeEvent`

This is the answer to "one message format for everything":

```ts
type AcpRuntimeEvent =
  | { type: "text_delta"; text: string; stream?: "output" | "thought"; tag?: AcpSessionUpdateTag }
  | { type: "status";    text: string; tag?: AcpSessionUpdateTag; used?: number; size?: number }
  | { type: "tool_call"; text: string; tag?: AcpSessionUpdateTag; toolCallId?: string; status?: string; title?: string }
  | { type: "done";      stopReason?: string }
  | { type: "error";     message: string; code?: string; retryable?: boolean }
```

Every agent (Pi, Codex, Claude, Gemini, Cursor…) produces this same event stream regardless of their underlying protocol quirks. acpx normalises everything.

`AcpSessionUpdateTag` covers: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `plan`, `current_mode_update`, `config_option_update`, `session_info_update`.

---

## What this means for Telegram rendering

Right now our Telegram delivery path is: run subprocess → capture final text → send message.

With `acpx/runtime` we get an `AsyncIterable<AcpRuntimeEvent>` in-process. We can:

```ts
const turn = runtime.startTurn({ handle, text: job.prompt, ... })

for await (const event of turn.events) {
  switch (event.type) {
    case "text_delta":
      if (event.stream === "thought") {
        // show "🤔 thinking..." typing indicator — update every N chars
      } else {
        // buffer output text
      }
      break
    case "tool_call":
      if (event.status === "in_progress") {
        // show "[🔧 running: Edit src/auth.ts]" as a Telegram status update
      }
      if (event.status === "completed") {
        // show "[✅ Edit src/auth.ts]"
      }
      break
    case "done":
      // send final buffered text as Telegram reply
      break
    case "error":
      // send error message
      break
  }
}
```

This is live streaming to Telegram — users see what the agent is doing while it's working, not just the final result. No more polling.

**The output formatters are already written:** `src/cli/output/output.ts` has `TextOutputFormatter`, `JsonOutputFormatter`, `QuietOutputFormatter` — 800 lines of battle-tested rendering logic including:
- Thought block truncation (900 char limit)
- Tool input summarisation (command, path, query — smart extraction)
- Tool output truncation (2000 chars / 28 lines)
- Diff summaries (`diff src/auth.ts (+3 lines)`)
- File location formatting (`src/auth.ts:42`)
- `--suppress-reads` filtering

We can import and reuse these directly for Telegram instead of reinventing them.

---

## The `FlowRunStore` and trace format: one persistence format for all jobs

Every flow run produces a structured bundle at `~/.acpx/flows/runs/<runId>/`:

```
manifest.json          schema: acpx.flow-run-bundle.v1
flow.json              flow definition snapshot
trace.ndjson           append-only event log: { seq, at, scope, type, runId, nodeId, payload }
projections/
  run.json             full FlowRunState
  live.json            lightweight live-updating state (current node, heartbeat)
  steps.json           step records
sessions/
  <sessionId>/
    binding.json       agent + cwd + acpx record ids
    record.json        acpx session record
    events.ndjson      raw ACP protocol messages with direction markers
artifacts/
  sha256-<hash>.<ext>  content-addressed: prompts, responses, shell outputs
```

**Opportunity:** adopt this same layout for our non-flow Telegram jobs. Instead of `results/<jobId>.json` (flat) we get a full auditable record of every job: what prompt was sent, what tools the agent used, what output came back, timing, token usage.

The trace NDJSON format is:
```ts
type FlowTraceEvent = {
  seq: number; at: string
  scope: "run" | "node" | "acp" | "action" | "session" | "artifact"
  type: string   // "run.started", "node.started", "node.finished", "acp.turn.started" etc
  runId: string; nodeId?: string; attemptId?: string; sessionId?: string
  artifact?: FlowArtifactRef   // sha256-addressed content
  payload: Record<string, unknown>
}
```

---

## The replay viewer: visual history in a browser

`examples/flows/replay-viewer/` is a production-quality React app (Vite + ReactFlow) that reads a run bundle directory and shows:

- **Graph view**: flow nodes as cards, current/completed/failed state
- **Timeline**: step-by-step execution timeline
- **Inspector panels**: conversation text, tool calls with input/output, session events
- **Playback controller**: scrub through the trace and replay step by step
- **Live mode**: connect to a running flow and watch it update in real-time (via `live-source.ts`)

This is built to work with the `FlowRunStore` format. If we adopt that format for all our jobs (Telegram or flow), every job gets a replay URL for free.

```bash
# serve replay viewer against a run dir
node server.ts ~/.acpx/flows/runs/<runId>
# or point it at ~/.pi-worker/results/<jobId> if we adopt the format
```

---

## `AcpRuntime` programmatic API: what we can do today

```ts
import { createAcpRuntime, createRuntimeStore, createAgentRegistry } from "acpx/runtime"

const runtime = createAcpRuntime({
  cwd: "/repo/myapp",
  sessionStore: createRuntimeStore({ stateDir: "~/.pi-worker" }),
  agentRegistry: createAgentRegistry(),
  permissionMode: "approve-all",
  timeoutMs: 600_000,
})

// One-shot (replaces our exec mode)
const handle = await runtime.ensureSession({
  sessionKey: jobId,
  agent: "pi",
  mode: "oneshot",
})

const turn = runtime.startTurn({
  handle,
  text: job.prompt,
  mode: "prompt",
  requestId: job.id,
  timeoutMs: 60_000,
})

// Stream events live
for await (const event of turn.events) {
  // update Telegram in real time
}

const result = await turn.result   // { status: "completed" | "cancelled" | "failed" }

// Persistent session (multi-turn — replaces our chatId-per-session plan)
const sessionHandle = await runtime.ensureSession({
  sessionKey: `${chatId}-pi`,       // scoped by chatId + agent
  agent: "pi",
  mode: "persistent",
  cwd: "/repo/myapp",
})

// Follow-up turn in same session — agent keeps context
const followUpTurn = runtime.startTurn({
  handle: sessionHandle,
  text: "now add tests for that",
  mode: "prompt",
  requestId: crypto.randomUUID(),
})
```

**Cancel** works cleanly: `turn.cancel()` sends ACP `session/cancel` and resolves. No process killing.

---

## `FlowRunner`: use directly in job runner

```ts
import { FlowRunner, defineFlow, acp, action, shell } from "acpx/flows"

const runner = new FlowRunner({
  resolveAgent: (profile) => ({
    agentName: profile ?? "pi",
    agentCommand: resolveAgentCommand(profile ?? "pi"),
    cwd: "/repo/myapp",
  }),
  permissionMode: "approve-all",
  timeoutMs: 30 * 60_000,
})

const result = await runner.run(myFlow, { input: { task: "fix failing tests" } })
// result.state has full FlowRunState — outputs, results, steps, sessionBindings
// result.runDir points to the bundle on disk
```

The `FlowRunner` handles: session lifecycle, heartbeats, retries, timeouts, trace emission, artifact storage, session event logging. We get all of this by calling `runner.run()`.

---

## Checkpoint nodes as Telegram approval gates

`checkpoint` nodes pause flow execution. We can implement Telegram approval by wiring:

1. Flow reaches `checkpoint` → emits `waiting` status in live projection
2. Our gateway polls `projections/live.json` or subscribes to the run bundle
3. Gateway sends Telegram message: "✋ Flow paused at: *review results* — reply /continue or /abort"
4. User replies `/continue <runId>`
5. Gateway resumes the flow runner (or signals it via the result channel)

The checkpoint node type already has `run?: (context) => MaybePromise<unknown>` — we can use this to write a file that a waiting gateway polls.

---

## Session event log: full ACP protocol record per session

Each persistent session stores its entire ACP message history as segmented NDJSON at:
```
~/.acpx/sessions/<acpxRecordId>/
  active.ndjson      current segment (rotating)
  segment-001.ndjson rotated segments
```

Each event: `{ seq, at, direction: "inbound"|"outbound", message: AcpJsonRpcMessage }`.

This means every Pi/Claude/Codex conversation is fully auditable, replayable, and inspectable — even outside of flows. For our Telegram bot this is extremely valuable: "show me the last 5 turns for chat X" becomes a file read.

---

## Conformance test suite

`conformance/cases/*.json` — 21 machine-readable conformance cases covering:
- initialize handshake
- session/new, prompt, cancel
- multi-turn conversations
- permission denied / approved
- unknown session handling
- structured prompt blocks
- background prompt completion

We can run these against our embedded runtime to validate Pi's ACP adapter is working correctly after updates. This is better than the ad-hoc smoke tests we have now.

---

## Summary: concrete things to do

### Immediate (in-process runtime, no more exec subprocess)

| Now | Replace with |
|-----|-------------|
| `acpx pi exec --format quiet` subprocess | `createAcpRuntime().startTurn()` in-process |
| polling result-channel for answer | `for await (event of turn.events)` |
| no Telegram streaming | real-time tool_call + thinking updates |
| flat `results/<jobId>.json` | `FlowRunStore` bundle (manifest + trace + artifacts) |

### Short term (persistent sessions, structured Telegram)

- Use `runtime.ensureSession({ mode: "persistent", sessionKey: chatId })` for multi-turn
- Reuse `TextOutputFormatter` / parse `AcpRuntimeEvent` for Telegram message formatting
- Import `parsePromptEventLine()` from acpx for consistent tool_call rendering

### Medium term (flows)

- Use `FlowRunner` directly for multi-step tasks
- Wire `checkpoint` nodes to Telegram approval replies
- Point replay viewer at our job store for visual history

### Long term (one format to rule them all)

Every job — Telegram prompt, flow step, direct API call — produces the same `FlowRunStore` bundle. One viewer. One audit log. One format for everything.

---

## One message format? Yes.

`AcpRuntimeEvent` is it. Whether the job is a one-shot Telegram message, a multi-turn conversation, a flow step in a 10-node pipeline, or a direct API call — the agent interaction always produces the same `AsyncIterable<AcpRuntimeEvent>`. 

acpx's entire job is normalising the 15+ different agent adapters into this one event stream. We inherit that normalisation for free.
