# Chief Architect Review: acpx PR Series + Architecture Diagram

> Status: partially implemented; current architecture is documented in `docs/architecture.md`.


**Date:** 2026-04-21  
**Reviewer:** Pi (chief architect mode) + claude-code cross-review via `acpx claude exec`  
**Scope:** PR1–PR6 value/core/leaf assessment + before/after architecture diagram

---

## PR Verdicts at a Glance

| PR | Title | Verdict | Core/Leaf | Merge Order |
|----|-------|---------|-----------|-------------|
| PR6 | Conformance suite | **SHIP IT** | Leaf (zero coupling) | 1st — independent |
| PR1 | In-process runtime | **SHIP WITH CHANGES** | Core (everything depends on it) | 2nd — foundation |
| PR4 | Persistent sessions | **SHIP WITH CHANGES** | Core behaviour (but isolated backend) | 3rd — semantic correctness |
| PR2 | Streaming Telegram | **SHIP WITH CHANGES** | Leaf (delivery adapter) | 4th — UX layer |
| PR3 | Run bundle format | **DEFER** | Infrastructure (not load-bearing yet) | 5th — after PR2 stable |
| PR5 | Flows + checkpoints | **DEFER** | Leaf (but poorly isolated) | 6th — after PR3 proven |

---

## Per-PR Architectural Comments

### PR1 — In-Process AcpxRuntime
**`feat/pr1-acpx-runtime-inline` | Core | SHIP WITH CHANGES**

**Value:** High. Eliminates the single worst architectural decision in the codebase — zombie subprocess, no cancel, no streaming, untyped pipe output. This is load-bearing.

**Core/Leaf:** Core. PR2, PR4, and the streaming path all depend on it. Cannot be removed once merged.

**Biggest risk:** `AcpxRuntime` is alpha. The `activeTurns` map is process-local — if the worker restarts mid-job, in-flight jobs disappear silently with no result written. The `Promise.race` zombie problem is solved but replaced with a silent-loss problem.

**Design smell:** Shared `runtime` singleton means a crash in one turn's event loop could poison the shared instance. `sessionKey = job.id` for one-shot is correct, but should be documented explicitly.

**Required before merge:**
1. Add process-restart recovery: if `readResult` returns null after timeout, write a `status: "failed"` tombstone instead of leaving the job in limbo.
2. Pin exact acpx version in `package.json` — it's alpha, `@latest` is not acceptable.
3. Document the singleton runtime lifecycle clearly in the backend.

---

### PR2 — Live Streaming Telegram
**`feat/pr2-acpx-streaming-telegram` | Leaf | SHIP WITH CHANGES**

**Value:** High UX. 3 minutes of silence is genuinely bad. This is the most visible improvement in the set.

**Core/Leaf:** Leaf. Cleanly removable — it's a delivery adapter over PR1. Coupling points: `TelegramApi` gets `editMessageText`, `telegram-poller.ts` gets a `streamingBackend` option. Both are additive and backwards-compatible.

**Biggest risk:** The fire-and-forget webhook handler is underspecified. If `deliverStreamingTurn` runs in the same async context as the HTTP handler, a 3-minute turn blocks or requires detached promise management. Bun's HTTP server has a 10-second request timeout by default — this design will time out without explicit detachment.

**Design smell:** Thought-excerpt Markdown escaping is listed as "strip/escape" without a concrete spec. User-generated agent thoughts containing underscores, backticks, or brackets *will* cause Telegram parse errors in production. This is guaranteed to break.

**Required before merge:**
1. Specify Markdown escaping: either escape all Markdown special chars in `_italic_` content, or use `parse_mode: "MarkdownV2"` with proper escaping.
2. Write down the fire-and-forget contract: `void deliverStreamingTurn(...)` inside the HTTP handler with an explicit unhandled-rejection handler.

---

### PR3 — Job Run Bundle Format
**`feat/pr3-acpx-run-bundles` | Infrastructure | DEFER**

**Value:** Medium-term. Observability is real, but premature before the execution path is stable. You're designing an audit format before you know what you need to audit.

**Core/Leaf:** Infrastructure but not load-bearing. The existing result-channel is kept in parallel, so nothing breaks if absent. Two coupling points: `acpx-runtime-backend.ts` (PR1) and `pi-worker-run-job.ts` both grow dual-write paths.

**Biggest risk:** `live.json` is rewritten on every `text_delta` event. A fast agent emits hundreds per second — this is a disk write storm. The plan hedges with "use temp file + rename if needed" but that's a note, not a fix.

**Design smell:** Two writes per job (result-channel + bundle) with no removal timeline for the old format. Technical debt baked in from day one.

**Required before shipping:**
1. Batch `live.json` updates on a timer (same throttle as PR2's Telegram edits — max 1 write per 2s).
2. Set a concrete migration date for removing the old result-channel format.

---

### PR4 — Persistent Sessions per Chat
**`feat/pr4-acpx-persistent-sessions` | Core behaviour | SHIP WITH CHANGES**

**Value:** Very high. Without this the agent is semantically broken for multi-turn use — every reply loses context. This is a correctness fix, not a feature.

**Core/Leaf:** Core behaviour but isolated. It's a separate backend (`acpx-persistent`), so rollback is a single env var change. Clean.

**Biggest risk:** `handleCache` is a module-level singleton — if imported in tests or multiple contexts, handle state bleeds across test cases. More critically: the retry logic on `ACP_SESSION_NOT_FOUND` may acquire the session lock while already inside the lock's critical section. Trace carefully — this could deadlock.

**Design smell:** `/reset` calls `runtime.close({ discardPersistentState: true })` but this method's existence on `AcpRuntime` is not verified against the type. The plan hedges "wrap in try/catch; fall back to cache eviction" — meaning reset might silently do nothing while telling the user "session reset."

**Required before merge:**
1. Move `handleCache` inside the factory function — not module-level.
2. Audit the retry + lock interaction for deadlock.
3. Verify `runtime.close` API signature before shipping — don't hedge around an unverified call.

---

### PR5 — FlowRunner + Telegram Checkpoints
**`feat/pr5-acpx-flows` | Leaf (poorly isolated) | DEFER**

**Value:** Real for complex multi-step tasks. But adds a second execution model alongside single-turn, plus filesystem IPC between processes.

**Core/Leaf:** Leaf, but poorly isolated. Coupling points: `telegram-poller.ts` grows checkpoint-detection polling on every cycle, new commands, a flow registry lookup, and a `monitorFlowProcess` helper. These are spread across the existing poller, not encapsulated.

**Biggest risk:** The checkpoint IPC mechanism (`checkpoint-request.json` / `checkpoint-response.json` polled every 3 seconds) is a message queue implemented with files. If you ever run the flow subprocess and the bot on different hosts (which is the direction this system is heading — VM pool), this silently breaks.

**Design smell:** `PI_FLOW_RUN_ID` threaded via environment variable into the checkpoint node. Env vars are invisible in the type system, not validated at startup, and wrong if more than one flow runs per process.

**Required before shipping:**
1. Replace filesystem IPC with in-process event emitter or proper queue entry.
2. Replace `PI_FLOW_RUN_ID` env threading with a typed parameter.
3. Encapsulate all flow-related poller logic into a `FlowCommandHandler` class, not spread across the existing poller.

---

### PR6 — ACP Conformance Suite
**`feat/pr6-acpx-conformance` | Leaf (zero coupling) | SHIP IT**

**Value:** High operational value. Without this, Pi ACP regressions surface via Telegram complaints. This gives us a systematic early-warning system.

**Core/Leaf:** Fully leaf. Zero production code changed. One new script, one new npm script. Can be removed with a single file delete.

**Biggest risk:** Assumes `node_modules/acpx/conformance/runner/run.js` exists. If acpx doesn't include the conformance runner in the npm artifact, this silently fails. Needs a startup probe.

**Design smell:** Running 21 cases sequentially at up to 30s each = 10-minute CI step. Too slow for a PR check.

**Required before merge (both are one-liners):**
1. Probe for the conformance runner path at startup with a clear error if missing.
2. CI uses the 9 core cases only; all 21 available on-demand via `/conformance`.

---

## Where acpx Simplified Things vs Where It Didn't

### Simplified ✓

| Area | Before | After |
|------|--------|-------|
| Agent invocation | Spawn subprocess, type into tmux pane, scrape XML from pane output | `runtime.startTurn()` → typed `AsyncIterable<AcpRuntimeEvent>` |
| Result collection | Poll `tmux capture-pane` every 2s, parse XML marker from raw text | `for await (event of turn.events)` — events arrive typed |
| Cancel | No-op comment in code | `turn.cancel()` → ACP `session/cancel` |
| Agent switching | Re-engineer the whole backend | `ACPX_AGENT=claude` env var |
| Error handling | Parse error from raw pane text or stdout | Typed `AcpRuntimeError` with error code |
| Multi-agent support | One backend per agent, bespoke integration | Universal: all agents speak ACP |
| Session state | None (every job fresh) | Persistent sessions per chatId via `acpx/runtime` |

### Did NOT simplify ✗

| Area | Why it's still complex |
|------|----------------------|
| Job queue and lease | Still needed. acpx doesn't manage our job queue — only agent sessions. |
| Telegram delivery | PR2 is new complexity (streaming, throttle, Markdown escaping). It's better UX but not simpler code. |
| Process lifecycle | `AcpxRuntime` is a long-lived in-process singleton — new failure modes (runtime poisoning, state leak) vs the old stateless subprocess model. |
| Persistence format | PR3 adds a second write path alongside the existing one. More complex during transition, not less. |
| Flows (PR5) | Adds a full second execution model. The system becomes more capable but also more complex to reason about. |
| Alpha dependency risk | We've traded operational fragility (PTY scraping) for API instability (alpha SDK). Different risk, not less risk. |

---

## Architecture Diagram: Before vs After acpx

### BEFORE acpx (current state)

```
┌─────────────────────────────────────────────────────────────┐
│  INBOUND                                                      │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ Telegram    │    │ HTTP Gateway │    │ CLI direct     │  │
│  │ poller/bot  │    │ (Bun HTTP)   │    │ pi-worker-*    │  │
│  └──────┬──────┘    └──────┬───────┘    └───────┬────────┘  │
│         └─────────────────┼───────────────────  │           │
└───────────────────────────┼───────────────────  ┼───────────┘
                            ▼                     ▼
              ┌─────────────────────────────────────┐
              │  JOB QUEUE  (~/.pi-worker/jobs/)    │
              │  jobs.ts — enqueue / claim / lease  │
              └─────────────────────┬───────────────┘
                                    │
                     pi-worker-run-job.ts (polls)
                                    │
              ┌─────────────────────▼───────────────┐
              │  BACKEND REGISTRY                   │
              │  createBackend(env.backend)         │
              └──┬──────────────┬──────────────┬────┘
                 │              │              │
         ┌───────▼───┐  ┌───────▼────┐  ┌─────▼──────┐
         │  tmux     │  │  smolvm    │  │  acpx      │
         │  backend  │  │  backend   │  │  backend   │
         └───────────┘  └────────────┘  └────────────┘
              │                │              │
    ┌─────────▼──────┐  ┌──────▼──────┐  ┌───▼─────────────┐
    │ tmux pane      │  │ SSH → VM    │  │ SUBPROCESS      │
    │ type prompt    │  │ pi -p "..."  │  │ acpx exec       │
    │ scrape XML     │  │ capture out │  │ --format quiet  │
    │ from pane      │  └─────────────┘  └─────────────────┘
    └────────────────┘       │                    │
              │              │                    │
              └──────────────┴────────────────────┘
                                    │
              ┌─────────────────────▼───────────────┐
              │  RESULT CHANNEL                     │
              │  ~/.pi-worker/jobs/results/*.json   │
              │  flat: { status, answer, error }    │
              └─────────────────────────────────────┘
                                    │
              ┌─────────────────────▼───────────────┐
              │  DELIVERY                           │
              │  telegram-runner polls every 2s     │
              │  sends final text message           │
              └─────────────────────────────────────┘

PROBLEMS:
  ✗ PTY scraping → brittle, ANSI noise, XML marker race
  ✗ No streaming → user sees silence for minutes
  ✗ No cancel → no-op, zombie processes
  ✗ No session context → every message is a fresh conversation
  ✗ No audit trail → flat JSON, no tool visibility
  ✗ Agent-locked → changing agent = new backend
```

---

### AFTER acpx (target state after PR1–PR5)

```
┌─────────────────────────────────────────────────────────────────────┐
│  INBOUND                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────────┐  │
│  │ Telegram    │    │ HTTP Gateway │    │ CLI / Flow trigger     │  │
│  │ poller/bot  │    │ (Bun HTTP)   │    │ pi-worker-flow-run.ts  │  │
│  └──────┬──────┘    └──────┬───────┘    └───────────┬────────────┘  │
│         │  /flow trigger   │                        │ FlowRunner     │
└─────────┼──────────────────┼────────────────────────┼───────────────┘
          │                  │                        │
          ▼                  ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  JOB QUEUE  (~/.pi-worker/jobs/)                                     │
│  jobs.ts — enqueue / claim / lease / heartbeat                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                  pi-worker-run-job.ts  ←── still used for tmux/smolvm
                                 │
┌────────────────────────────────▼────────────────────────────────────┐
│  BACKEND REGISTRY  createBackend(env.backend)                        │
└───────────┬─────────────────────────────────────────────────────────┘
            │
   ┌─────────┴──────────┬──────────────────┬─────────────────┐
   │                    │                  │                  │
   ▼                    ▼                  ▼                  ▼
tmux backend      smolvm backend    acpx-runtime        acpx-persistent
(unchanged)       (unchanged)       backend (PR1)       backend (PR4)
                                         │                    │
                                         └────────┬───────────┘
                                                  │
                                    ┌─────────────▼──────────────────┐
                                    │  AcpxRuntime (in-process)       │
                                    │  acpx/runtime                   │
                                    │                                 │
                                    │  ensureSession()                │
                                    │  startTurn() → AcpRuntimeTurn   │
                                    │  turn.events: AsyncIterable<    │
                                    │    AcpRuntimeEvent>             │
                                    │  turn.cancel()                  │
                                    └─────────────┬──────────────────┘
                                                  │
                                    ┌─────────────▼──────────────────┐
                                    │  ACP Protocol (stdio)           │
                                    │  JSON-RPC 2.0                   │
                                    └──────────┬──────────────────────┘
                                               │
              ┌────────────────────────────────┼──────────────────────┐
              │                                │                      │
              ▼                                ▼                      ▼
         pi-acp                          codex-acp               claude-acp
    (Pi coding agent)              (OpenAI Codex)          (Anthropic Claude)
    + any future ACP agent

                   ─────── AcpRuntimeEvent stream flows back up ────────

┌────────────────────────────────────────────────────────────────────┐
│  EVENT CONSUMERS (parallel)                                         │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │ Streaming Telegram   │    │  Job Run Bundle (PR3)            │  │
│  │ delivery (PR2)       │    │  ~/.pi-worker/runs/<jobId>/      │  │
│  │                      │    │  manifest.json                   │  │
│  │ tool_call → 🔧 edit  │    │  trace.ndjson (all events)       │  │
│  │ thought  → 🤔 edit   │    │  projections/live.json           │  │
│  │ done     → final msg │    │  artifacts/sha256-*.txt          │  │
│  └──────────────────────┘    └──────────────────────────────────┘  │
│                                           │                         │
│                              ┌────────────▼──────────────────────┐  │
│                              │  Replay Viewer (acpx examples)    │  │
│                              │  Visual step-by-step playback     │  │
│                              │  Live mode: watch in real-time    │  │
│                              └───────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  PERSISTENT SESSION STORE  (PR4)                                    │
│  ~/.pi-worker/acp/sessions/<pi-<chatId>>.json                       │
│  ACP session ID survives across Telegram messages                   │
│  Agent context accumulates — no more "what module?" confusion       │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  FLOWS  (PR5)                                                        │
│  flows/diagnose-and-fix.flow.ts                                     │
│  FlowRunner → acp + action + checkpoint nodes                       │
│  Checkpoint → Telegram approval gate → /continue or /abort         │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  CONFORMANCE  (PR6)                                                  │
│  pi-worker-conformance.ts                                           │
│  21 ACP protocol cases against pi-acp adapter                      │
│  Run after Pi updates — fail fast before users notice              │
└────────────────────────────────────────────────────────────────────┘

IMPROVEMENTS:
  ✓ No PTY scraping → typed AcpRuntimeEvent stream
  ✓ Live Telegram streaming → users see thinking + tool calls
  ✓ Real cancel → turn.cancel() → ACP session/cancel
  ✓ Persistent sessions → agent remembers conversation context
  ✓ Full audit trail → trace.ndjson per job
  ✓ Agent-agnostic → swap pi→claude via ACPX_AGENT env var
  ✓ Conformance tests → Pi ACP regressions caught early
  ✓ Flows → multi-step tasks with human approval gates

NEW COMPLEXITY:
  ⚠ AcpxRuntime singleton lifetime and failure modes
  ⚠ Streaming + throttle + Markdown escaping in delivery layer
  ⚠ Two write paths during PR3 migration
  ⚠ Persistent session TTL + cleanup daemon
  ⚠ Filesystem IPC for flow checkpoints (to be replaced)
  ⚠ Alpha SDK dependency throughout
```

---

## Architectural Verdict

**The core trade:** We are trading operational fragility (PTY scraping, XML marker parsing, zombie processes) for API instability (alpha SDK, in-process runtime with new failure modes). This is the right trade — the old fragility was silent and unrecoverable; the new instability is loud, typed, and recoverable.

**The load-bearing question answered:**

- `WorkerBackend` interface → **core, stable, keep**
- `JobQueue` + lease → **core, stable, keep** — acpx doesn't replace job queuing
- `acpx/runtime` → **core dependency, alpha, pin version**
- Telegram streaming (PR2) → **leaf, clean removal = delete one file + one poller option**
- Run bundles (PR3) → **infrastructure, not load-bearing, defer**
- Persistent sessions (PR4) → **core behaviour, isolated implementation**
- Flows (PR5) → **leaf capability, needs better isolation before shipping**
- Conformance (PR6) → **fully leaf, zero coupling, ship it now**

**The system can grow because acpx gives us the universal event bus.** Every agent interaction produces `AcpRuntimeEvent`. Telegram, flows, replay viewer, audit logs — they all consume the same stream. That's the real architectural win: one normalized format, many consumers, agent-agnostic.
