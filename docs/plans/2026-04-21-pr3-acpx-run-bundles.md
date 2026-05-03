# PR3: Adopt FlowRunStore bundle format for all jobs

**Branch:** `feat/pr3-acpx-run-bundles`  
**Status:** pending  
**Depends on:** PR1 (`feat/pr1-acpx-runtime-inline`)  
**Estimated scope:** ~400 LOC new, ~120 LOC changed

---

## Why

Today every job writes two flat JSON files:

```
~/.pi-worker/jobs/requests/<jobId>.json   ← prompt, metadata
~/.pi-worker/jobs/results/<jobId>.json    ← answer or error
```

There is no trace of what happened during the job: which tools were called, how long each step took, what the agent was thinking, token usage, or any intermediate state. If a job fails at step 3 of 8, the result says "failed" with no context.

The acpx `FlowRunStore` format stores every job as a structured bundle. We adapt this format for single-turn jobs (Telegram prompts, one-shot runs) and get:

- **Full audit trail**: every `AcpRuntimeEvent` is traced as a `JobTraceEvent` to `trace.ndjson`
- **Live status polling**: `projections/live.json` updated during the turn for the gateway/Telegram poller to read without waiting for completion
- **Content-addressed artifacts**: prompt and response text stored as sha256 files — deduplication for free
- **Replay-viewer compatibility**: the bundle layout is close enough to `FlowRunStore` that acpx's replay viewer can be pointed at it
- **Foundation for PR4 and PR5**: sessions and flows need a place to write per-job state

---

## Bundle Layout

Every job produces a directory at `~/.pi-worker/runs/<jobId>/`:

```
~/.pi-worker/runs/<jobId>/
  manifest.json              job metadata, schema version, status
  trace.ndjson               append-only event log (one JSON object per line)
  projections/
    live.json                lightweight current-state snapshot, updated during turn
    run.json                 full job state (written on completion)
  artifacts/
    sha256-<hash>.txt        content-addressed text files (prompt, response)
```

### `manifest.json` schema

```ts
type JobRunManifest = {
  schema: "pi-worker.job-run-bundle.v1"
  id: string              // == jobId
  chatId: string
  backendId: string
  createdAt: string       // ISO-8601
  startedAt: string | null
  completedAt: string | null
  status: "pending" | "running" | "done" | "failed" | "cancelled"
  promptArtifact: string | null    // sha256-<hash>.txt relative path
  responseArtifact: string | null  // sha256-<hash>.txt relative path
  errorMessage: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
}
```

### `trace.ndjson` schema

Each line is a `JobTraceEvent`:

```ts
type JobTraceEvent = {
  seq: number        // monotonically increasing per-job
  at: string         // ISO-8601 timestamp
  scope: "job" | "acp" | "artifact"
  type: string       // see table below
  jobId: string
  payload: Record<string, unknown>
  artifact?: { path: string; sha256: string }  // set for artifact-scope events
}
```

Event types by scope:

| scope | type | payload fields |
|-------|------|----------------|
| job | `job.started` | `chatId`, `backendId` |
| job | `job.prompt_sent` | `promptArtifact` (sha256 ref), `promptLength` |
| acp | `acp.turn.started` | `requestId`, `sessionKey` |
| acp | `acp.event.text_delta` | `stream` ("output"/"thought"), `textLength`, `cumulativeLength` |
| acp | `acp.event.tool_call` | `title`, `status`, `toolCallId` |
| acp | `acp.event.status` | `text`, `used`, `size` |
| job | `job.completed` | `stopReason`, `responseArtifact`, `responseLength`, `durationMs` |
| job | `job.failed` | `errorMessage`, `errorCode`, `durationMs` |
| job | `job.cancelled` | `reason`, `durationMs` |
| artifact | `artifact.written` | `path`, `sha256`, `sizeBytes` |

`text_delta` events do not store the full text — only length deltas — to avoid bloating the trace. Full text lives in `artifacts/`.

### `projections/live.json` schema

```ts
type JobLiveProjection = {
  id: string
  status: "running" | "done" | "failed" | "cancelled" | "waiting"
  updatedAt: string
  currentAction: string | null    // e.g. "🔧 Running: Edit src/auth.ts"
  outputLengthSoFar: number
  toolCallsCompleted: number
  waitingOn: string | null        // e.g. "telegram:<chatId>" — used by PR5 checkpoint gates
}
```

`live.json` is overwritten (not appended) on every significant event. Gateway and Telegram poller can `stat` it to detect updates without reading the full trace.

### `projections/run.json` schema

Written once on completion:

```ts
type JobRunProjection = {
  id: string
  chatId: string
  status: "done" | "failed" | "cancelled"
  completedAt: string
  durationMs: number
  prompt: string         // full text (or "artifact:<sha256>")
  response: string       // full text (or "artifact:<sha256>")
  toolCallsLog: Array<{ title: string; status: string; at: string }>
  traceEventCount: number
  artifacts: string[]    // list of artifact paths
}
```

---

## New File: `scripts/vm/lib/job-run-store.ts`

```ts
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises"
import { join } from "node:path"
import type { JobRunManifest, JobTraceEvent, JobLiveProjection, JobRunProjection } from "./job-run-types"

export function createJobRunStore(runsDir: string) {
  function runDir(jobId: string) {
    return join(runsDir, jobId)
  }

  async function init(jobId: string, chatId: string, backendId: string): Promise<string> {
    const dir = runDir(jobId)
    await mkdir(join(dir, "projections"), { recursive: true })
    await mkdir(join(dir, "artifacts"), { recursive: true })

    const manifest: JobRunManifest = {
      schema: "pi-worker.job-run-bundle.v1",
      id: jobId,
      chatId,
      backendId,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      status: "pending",
      promptArtifact: null,
      responseArtifact: null,
      errorMessage: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))
    return dir
  }

  async function appendTrace(jobId: string, event: Omit<JobTraceEvent, "seq">): Promise<void> {
    const tracePath = join(runDir(jobId), "trace.ndjson")
    // seq is best-effort monotonic from file line count; not guaranteed under parallel writes
    const line = JSON.stringify(event) + "\n"
    await appendFile(tracePath, line)
  }

  async function writeArtifact(jobId: string, content: string, ext = "txt"): Promise<string> {
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex")
    const filename = `sha256-${sha256}.${ext}`
    const artifactPath = join(runDir(jobId), "artifacts", filename)
    await writeFile(artifactPath, content, "utf8")
    return filename   // relative path within the run dir
  }

  async function updateLive(jobId: string, patch: Partial<JobLiveProjection>): Promise<void> {
    const livePath = join(runDir(jobId), "projections", "live.json")
    let current: JobLiveProjection
    try {
      current = JSON.parse(await readFile(livePath, "utf8"))
    } catch {
      current = {
        id: jobId,
        status: "running",
        updatedAt: new Date().toISOString(),
        currentAction: null,
        outputLengthSoFar: 0,
        toolCallsCompleted: 0,
        waitingOn: null,
      }
    }
    await writeFile(livePath, JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2))
  }

  async function finalize(
    jobId: string,
    status: "done" | "failed" | "cancelled",
    opts: { response?: string; errorMessage?: string; stopReason?: string; durationMs: number },
  ): Promise<void> {
    const dir = runDir(jobId)
    const manifest: JobRunManifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))
    manifest.status = status
    manifest.completedAt = new Date().toISOString()
    if (opts.errorMessage) manifest.errorMessage = opts.errorMessage
    if (opts.response) {
      manifest.responseArtifact = await writeArtifact(jobId, opts.response)
    }
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2))

    await updateLive(jobId, {
      status,
      currentAction: null,
      waitingOn: null,
    })
  }

  async function readLive(jobId: string): Promise<JobLiveProjection | null> {
    try {
      return JSON.parse(await readFile(join(runDir(jobId), "projections", "live.json"), "utf8"))
    } catch {
      return null
    }
  }

  async function readManifest(jobId: string): Promise<JobRunManifest | null> {
    try {
      return JSON.parse(await readFile(join(runDir(jobId), "manifest.json"), "utf8"))
    } catch {
      return null
    }
  }

  return { init, appendTrace, writeArtifact, updateLive, finalize, readLive, readManifest, runDir }
}
```

---

## New File: `scripts/vm/lib/job-run-types.ts`

Contains the TypeScript types for all bundle schemas — `JobRunManifest`, `JobTraceEvent`, `JobLiveProjection`, `JobRunProjection`. Kept separate from `job-run-store.ts` so consumers (e.g. gateway routes) can import types without importing the store implementation.

---

## Changes to `acpx-runtime-backend.ts` (from PR1)

Replace direct `resultChannel.writeResult` calls with `JobRunStore` operations inside `submitPrompt`:

```ts
const runStore = createJobRunStore(join(options.stateDir, "runs"))

// Before turn:
await runStore.init(job.id, job.chatId, "acpx-runtime")
const promptArtifact = await runStore.writeArtifact(job.id, job.prompt)
await runStore.updateLive(job.id, { status: "running", currentAction: "🤔 Thinking…" })
await runStore.appendTrace(job.id, { at: nowIso(), scope: "job", type: "job.started", jobId: job.id, payload: { chatId: job.chatId, backendId: "acpx-runtime" } })
await runStore.appendTrace(job.id, { at: nowIso(), scope: "job", type: "job.prompt_sent", jobId: job.id, payload: { promptArtifact, promptLength: job.prompt.length } })

// During event loop:
for await (const event of turn.events) {
  switch (event.type) {
    case "text_delta":
      outputChunks.push(event.text)
      await runStore.appendTrace(job.id, { at: nowIso(), scope: "acp", type: "acp.event.text_delta", jobId: job.id, payload: { stream: event.stream ?? "output", textLength: event.text.length } })
      if (event.stream !== "thought") {
        await runStore.updateLive(job.id, { outputLengthSoFar: outputChunks.join("").length })
      }
      break
    case "tool_call":
      await runStore.appendTrace(job.id, { at: nowIso(), scope: "acp", type: "acp.event.tool_call", jobId: job.id, payload: { title: event.title, status: event.status, toolCallId: event.toolCallId } })
      await runStore.updateLive(job.id, { currentAction: event.status === "in_progress" ? `🔧 ${event.title ?? event.text.slice(0, 60)}` : null })
      break
  }
}
```

The `resultChannel.writeResult` calls are **kept in addition** to run store writes (not replaced) to maintain backward compatibility with `readResult` polling in `pi-worker-run-job.ts`.

---

## Changes to `scripts/vm/lib/state-store.ts`

Add `runsDir` path to `stateStore.paths`:

```ts
paths: {
  ...existing,
  runsDir: join(stateDir, "runs"),
}
```

---

## Migration: Backward Compatibility

Jobs submitted before PR3 deploy have no run bundle. The gateway's `/status` endpoint and Telegram poller must handle `readLive` returning `null` gracefully — fall back to `resultChannel.readResult` for in-flight jobs. This fallback can be removed after one deploy cycle.

Concretely in `pi-worker-run-job.ts`:

```ts
const live = await runStore.readLive(jobId).catch(() => null)
if (live?.status === "done") {
  // fast path: read from run bundle
  const manifest = await runStore.readManifest(jobId)
  // ...
} else {
  // old path: poll resultChannel
  const answer = await backend.readResult(job)
  // ...
}
```

---

## Task Checklist

- [ ] Create `scripts/vm/lib/job-run-types.ts` with all TypeScript type definitions
- [ ] Create `scripts/vm/lib/job-run-store.ts` with store implementation
- [ ] Add `runsDir` to `state-store.ts` paths
- [ ] Extend `acpx-runtime-backend.ts` (PR1) to write run bundle alongside result-channel writes
- [ ] Update `pi-worker-run-job.ts` to prefer `runStore.readLive` when available
- [ ] Add `runs/` to `.gitignore` (state data, not tracked)
- [ ] Write unit tests
- [ ] Manual verification: after a job completes, inspect `~/.pi-worker/runs/<jobId>/manifest.json` and `trace.ndjson`

---

## Test Strategy

File: `scripts/vm/lib/job-run-store.test.ts`

**Test 1 — init creates correct directory structure:**  
`init(jobId, chatId, "acpx-runtime")` → directories `runs/<jobId>/artifacts/` and `runs/<jobId>/projections/` exist; `manifest.json` is valid `JobRunManifest` with `status: "pending"`.

**Test 2 — trace append is ordered:**  
Append 5 trace events → `trace.ndjson` has 5 lines, each parseable as `JobTraceEvent`.

**Test 3 — artifact content addressing:**  
`writeArtifact(jobId, "hello world")` → file `artifacts/sha256-<hash>.txt` contains "hello world". Calling with the same content writes to the same filename (idempotent).

**Test 4 — live.json updated and readable:**  
`updateLive(jobId, { currentAction: "🔧 Edit src/auth.ts" })` → `readLive(jobId)` returns object with `currentAction` set.

**Test 5 — finalize transitions status:**  
`finalize(jobId, "done", { response: "Fixed it.", durationMs: 3000 })` → `manifest.json` has `status: "done"`, `responseArtifact` is set, `live.json` has `status: "done"`.

**Test 6 — readLive returns null for missing run:**  
`readLive("nonexistent-job")` returns `null` without throwing.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `appendFile` to `trace.ndjson` from concurrent processes (e.g. two workers claiming same job) | Low — job lease prevents this | Job lease in `state-store.ts` ensures only one runner per job; document this assumption |
| `live.json` read-modify-write in `updateLive` is not atomic — partial writes possible | Low | `writeFile` on most filesystems is atomic for small files; use a temp file + rename if needed |
| Run bundle directories accumulate indefinitely on disk | Medium | Add `pi-worker-prune-runs` script that deletes bundles older than N days (configurable via `PI_WORKER_RUNS_RETENTION_DAYS`) |
| acpx `FlowRunStore` format diverges from our `JobRunManifest` schema | Low — we control our schema | Document divergence in schema comments; converging is a later optional step |

---

## Definition of Done

- After `PI_WORKER_BACKEND=acpx-runtime bun scripts/vm/pi-worker-run-job.ts <jobId>` completes:
  - `~/.pi-worker/runs/<jobId>/manifest.json` exists with `status: "done"`
  - `~/.pi-worker/runs/<jobId>/trace.ndjson` has at least `job.started`, `acp.turn.started`, `job.completed` events
  - `~/.pi-worker/runs/<jobId>/projections/live.json` has `status: "done"`
  - `~/.pi-worker/runs/<jobId>/artifacts/sha256-*.txt` contains the response text
- All 6 unit tests pass.
- Old result-channel files still written — `pi-worker-run-job.ts` completes successfully reading from either path.
- `readLive` returning `null` does not crash the gateway or Telegram poller.
