# PR2: Live streaming AcpRuntimeEvent to Telegram

**Branch:** `feat/pr2-acpx-streaming-telegram`  
**Status:** pending  
**Depends on:** PR1 (`feat/pr1-acpx-runtime-inline`)  
**Estimated scope:** ~300 LOC new, ~80 LOC changed

---

## Why

The current Telegram delivery path for all backends is:

1. Accept message → enqueue job
2. `pi-worker-telegram-bot.ts` polls `queue.getJob()` every `jobPollIntervalMs` (default 2 s)
3. When job status becomes `done`, send the final answer as a Telegram message

For a job that takes 3 minutes, the user sees: one message in, silence, one message out. No indication the agent is working, no visibility into tool calls, no thinking progress.

PR1 gives us `AsyncIterable<AcpRuntimeEvent>` in-process. PR2 uses that stream to send live status updates to Telegram as the agent works: thinking indicators, tool calls, completion.

The result: users see the agent "thinking", see each tool call as it starts and finishes, and receive the final answer — all without any polling.

---

## Current vs New Flow

**Current (all backends):**
```
User sends message
  → telegram-bot.ts enqueues job
  → pi-worker-run-job polls backend.readResult every 2s
  → on done: queue.completeJob, telegram bot picks up, sends final text
```

**New (acpx-runtime backend):**
```
User sends message
  → telegram-bot.ts invokes StreamingTelegramDelivery directly
  → StreamingTelegramDelivery calls runtime.ensureSession + startTurn
  → on turn start: telegram.sendMessage("🤔 Thinking...") → save messageId
  → on text_delta(thought): throttled editMessage "🤔 [thought excerpt]..."
  → on tool_call(in_progress): throttled editMessage "🔧 Running: [title]"
  → on tool_call(completed): throttled editMessage "✅ [title]"
  → on turn.result completed: editMessage with full buffered output (or send new if too long)
  → on turn.result failed: editMessage with error text
```

The old poll loop (`pi-worker-run-job.ts`) is retained unchanged for `tmux` and `smolvm` backends.

---

## New File: `scripts/vm/lib/streaming-telegram-delivery.ts`

```ts
import type { AcpRuntimeTurn } from "acpx/runtime"
import type { TelegramApi } from "./telegram-api"

export type StreamingDeliveryOptions = {
  chatId: number
  telegram: TelegramApi
  /** Max ms between Telegram editMessage calls. Default: 2000 */
  throttleMs?: number
  /** Max chars to show from a thought excerpt. Default: 100 */
  thoughtExcerptChars?: number
  /** Max chars in a single Telegram message (hard limit: 4096). Default: 3800 */
  maxMessageChars?: number
}

type LiveMessageState = {
  messageId: number
  lastEditAt: number
  pendingText: string | null   // set when an edit is scheduled but not yet sent
}

export async function deliverStreamingTurn(
  turn: AcpRuntimeTurn,
  opts: StreamingDeliveryOptions,
): Promise<void> {
  const throttleMs = opts.throttleMs ?? 2000
  const excerptChars = opts.thoughtExcerptChars ?? 100
  const maxChars = opts.maxMessageChars ?? 3800

  // Send initial placeholder — we need a messageId to edit
  const sentMsg = await opts.telegram.sendMessage(opts.chatId, "🤔 _Thinking…_", {
    parse_mode: "Markdown",
  })
  const state: LiveMessageState = {
    messageId: (sentMsg as { message_id: number }).message_id,
    lastEditAt: Date.now(),
    pendingText: null,
  }

  let throttleTimer: ReturnType<typeof setTimeout> | null = null
  const outputChunks: string[] = []
  const toolCallLog: string[] = []   // ordered log of completed tool calls

  function scheduleEdit(newText: string) {
    state.pendingText = newText
    if (throttleTimer !== null) return   // already scheduled
    const sinceLastEdit = Date.now() - state.lastEditAt
    const delay = Math.max(0, throttleMs - sinceLastEdit)
    throttleTimer = setTimeout(async () => {
      throttleTimer = null
      const text = state.pendingText
      if (!text) return
      state.pendingText = null
      try {
        await opts.telegram.editMessageText(opts.chatId, state.messageId, text, {
          parse_mode: "Markdown",
        })
        state.lastEditAt = Date.now()
      } catch {
        // Telegram editMessage can fail if message is unchanged; ignore
      }
    }, delay)
  }

  function buildStatusText(currentAction: string): string {
    const lines: string[] = []
    for (const completed of toolCallLog) {
      lines.push(completed)
    }
    if (currentAction) lines.push(currentAction)
    return lines.join("\n") || "🤔 _Thinking…_"
  }

  let currentToolTitle = ""

  for await (const event of turn.events) {
    switch (event.type) {
      case "text_delta":
        if (event.stream === "thought") {
          const excerpt = event.text.slice(0, excerptChars).replace(/\n/g, " ")
          scheduleEdit(buildStatusText(`🤔 _${excerpt}…_`))
        } else {
          // output stream — buffer for final message
          outputChunks.push(event.text)
        }
        break

      case "tool_call":
        if (event.status === "in_progress") {
          currentToolTitle = event.title ?? event.text.slice(0, 60)
          scheduleEdit(buildStatusText(`🔧 _Running: ${currentToolTitle}_`))
        } else if (event.status === "completed") {
          toolCallLog.push(`✅ \`${currentToolTitle}\``)
          currentToolTitle = ""
          scheduleEdit(buildStatusText(""))
        }
        break

      case "status":
        // status events (e.g. usage_update) — ignore for Telegram display
        break
    }
  }

  // Cancel any pending throttled edit — we are about to send the final message
  if (throttleTimer !== null) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }

  const result = await turn.result
  const fullOutput = outputChunks.join("").trim()

  if (result.status === "completed") {
    if (!fullOutput) {
      await opts.telegram.editMessageText(
        opts.chatId,
        state.messageId,
        toolCallLog.length > 0 ? toolCallLog.join("\n") + "\n\n_(no output)_" : "_(no output)_",
        { parse_mode: "Markdown" },
      )
    } else if (fullOutput.length <= maxChars) {
      await opts.telegram.editMessageText(opts.chatId, state.messageId, fullOutput)
    } else {
      // Output too long for a single edit — edit placeholder, send full as new message
      await opts.telegram.editMessageText(
        opts.chatId,
        state.messageId,
        toolCallLog.join("\n") || "✅ _Done_",
        { parse_mode: "Markdown" },
      )
      // Split into chunks and send sequentially
      for (let offset = 0; offset < fullOutput.length; offset += maxChars) {
        await opts.telegram.sendMessage(opts.chatId, fullOutput.slice(offset, offset + maxChars))
      }
    }
  } else if (result.status === "cancelled") {
    await opts.telegram.editMessageText(
      opts.chatId,
      state.messageId,
      `⚠️ _Cancelled_: ${result.stopReason ?? "no reason"}`,
      { parse_mode: "Markdown" },
    )
  } else {
    // failed
    const errText = `❌ _Error_: ${result.error.message}${result.error.code ? ` \`(${result.error.code})\`` : ""}`
    await opts.telegram.editMessageText(opts.chatId, state.messageId, errText, {
      parse_mode: "Markdown",
    })
  }
}
```

---

## Changes to `scripts/vm/lib/telegram-api.ts`

The existing `TelegramApi` type needs two new methods:

```ts
export interface TelegramApi {
  // existing
  api(method: string, body: Record<string, unknown>): Promise<unknown>
  sendMessage(chatId: number, text: string, extra?: Record<string, unknown>): Promise<unknown>
  isAllowed(chatId: number): boolean
  // NEW
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<unknown>
}
```

Implementation in `createTelegramApi`:

```ts
editMessageText(chatId, messageId, text, extra = {}) {
  return this.api("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra,
  })
},
```

---

## Changes to `scripts/vm/lib/telegram-poller.ts`

The poller currently enqueues jobs and lets `pi-worker-run-job.ts` handle execution. For the `acpx-runtime` backend, we want to run the turn inline in the webhook handler and stream back.

New option on `createTelegramPoller`:

```ts
export type TelegramPollerOptions = {
  queue: JobQueue
  telegram: TelegramApi
  commands: TelegramCommands
  helpText: string
  // NEW: if set, plain-text messages use streaming delivery instead of queue
  streamingBackend?: {
    runtime: AcpRuntime
    agent: string
    acpxStateDir: string
    cwd: string | undefined
    timeoutMs: number
  }
}
```

In the plain-text / `/run` handler:

```ts
if (opts.streamingBackend) {
  const { runtime, agent, cwd, timeoutMs } = opts.streamingBackend
  const handle = await runtime.ensureSession({
    sessionKey: `oneshot-${crypto.randomUUID()}`,
    agent,
    mode: "oneshot",
    cwd,
  })
  const turn = runtime.startTurn({
    handle,
    text: prompt,
    mode: "prompt",
    requestId: crypto.randomUUID(),
    timeoutMs,
  })
  await deliverStreamingTurn(turn, {
    chatId,
    telegram: opts.telegram,
    throttleMs: env.telegramTypingIntervalMs,
  })
  return { ok: true }
}
// else: fall through to existing queue path
```

---

## Changes to `scripts/vm/pi-worker-telegram-bot.ts`

Wire the streaming backend when `env.backend === "acpx-runtime"`:

```ts
import { AcpxRuntime, createAgentRegistry, createFileSessionStore } from "acpx/runtime"

const streamingBackend = env.backend === "acpx-runtime"
  ? {
      runtime: new AcpxRuntime({
        cwd: env.acpx.cwd ?? process.cwd(),
        sessionStore: createFileSessionStore({ stateDir: env.acpx.stateDir }),
        agentRegistry: createAgentRegistry(),
        permissionMode: "approve-all",
        timeoutMs: env.acpx.timeoutMs,
      }),
      agent: env.acpx.agent,
      acpxStateDir: env.acpx.stateDir,
      cwd: env.acpx.cwd,
      timeoutMs: env.acpx.timeoutMs,
    }
  : undefined

const poller = createTelegramPoller({
  queue,
  telegram,
  commands: { ... },
  helpText,
  streamingBackend,
})
```

Non-streaming backends (`tmux`, `smolvm`, `acpx`) continue to use the existing queue + poll path unmodified.

---

## Throttle Strategy

Telegram enforces a global rate limit of 30 messages/second per bot and a per-chat limit of approximately 1 message/second for edits. Our throttle:

- `throttleMs` defaults to `env.telegramTypingIntervalMs` (default 4000 ms — already in env.ts)
- The `scheduleEdit` function tracks `lastEditAt` and schedules the next edit no sooner than `throttleMs` after the previous one
- If multiple events arrive during a throttle window, only the most recent pending text is sent (no queue buildup)
- Final delivery (on `turn.result`) bypasses the throttle and always sends synchronously

This ensures at most ~1 Telegram API call per 4 seconds during a long agent run, well within rate limits.

---

## Markdown Formatting Rules

| Content | Format |
|---------|--------|
| Thought excerpt | `_italic_` |
| Tool call in progress | `_Running: toolname_` |
| Tool call completed | `` `toolname` `` prefixed with ✅ |
| Final output | Plain text (no Markdown — user output may contain unescaped chars) |
| Error | `_Error_: message \`(CODE)\`` |
| Cancelled | `_Cancelled_: reason` |

Final output is intentionally sent as plain text (no `parse_mode`) to avoid Markdown parse errors from agent output containing backticks, underscores, or brackets.

---

## Non-streaming Fallback

When `streamingBackend` is not set (all non-`acpx-runtime` backends), `createTelegramPoller` uses the existing code path: enqueue job, poll for completion, send final message. No behaviour change for `tmux` or `smolvm`.

---

## Task Checklist

- [ ] Add `editMessageText` to `TelegramApi` interface and `createTelegramApi` implementation
- [ ] Create `scripts/vm/lib/streaming-telegram-delivery.ts`
- [ ] Add `streamingBackend` option to `TelegramPollerOptions` in `telegram-poller.ts`
- [ ] Wire streaming path in `pi-worker-telegram-bot.ts`
- [ ] Add `throttleMs` respected from `env.telegramTypingIntervalMs`
- [ ] Write unit tests (see below)
- [ ] Manual test: send a Telegram message with `PI_WORKER_BACKEND=acpx-runtime` and observe live edits

---

## Test Strategy

File: `scripts/vm/lib/streaming-telegram-delivery.test.ts`

**Test 1 — live edit sequence:**  
Mock turn emitting `thought`, `tool_call(in_progress)`, `tool_call(completed)`, `text_delta(output)` events. Assert `editMessageText` is called with correct strings in correct order. Assert final output is sent as the final edit.

**Test 2 — throttle enforcement:**  
Emit 10 rapid `text_delta(thought)` events within a 100 ms window. Assert `editMessageText` is called at most 1 time (throttle = 2000 ms). Assert the single edit reflects the last-seen thought text.

**Test 3 — output split on length:**  
Mock output exceeding 3800 chars. Assert `editMessageText` is called once (for the status placeholder) and `sendMessage` is called twice (two chunks of output).

**Test 4 — failed turn:**  
`turn.result` resolves `{ status: "failed", error: { message: "connection lost", code: "ACP_AGENT_DIED" } }`. Assert final `editMessageText` contains "❌" and the error code.

**Test 5 — cancelled turn:**  
`turn.cancel()` called from outside delivery. Assert final `editMessageText` contains "⚠️ Cancelled".

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Telegram `editMessageText` "message is not modified" 400 error when pending text equals previous text | Medium | Catch and ignore Telegram API errors in `scheduleEdit` |
| Very long thought text with special Markdown chars causes parse error | Medium | Strip/escape Markdown from excerpts; send thought text in `_italic_` only after truncating to `excerptChars` |
| Streaming backend holds a long HTTP connection open during 3 min agent run, Telegram webhook times out | High | Telegram webhook handler must return 200 immediately and run delivery in a background task; adjust handler to fire-and-forget `deliverStreamingTurn` |
| Multiple simultaneous Telegram messages from same user overwhelm the runtime | Low | Rate limiting per chatId already planned in PR4 sessions |

---

## Definition of Done

- Sending a Telegram message while `PI_WORKER_BACKEND=acpx-runtime` produces at least one intermediate "🤔" or "🔧" edit before the final answer.
- Final answer text exactly matches the `text_delta(output)` content buffered during the turn.
- All 5 unit tests pass.
- Non-streaming backends send exactly one message (final answer) — no regression.
- No Telegram API 429 (rate limit) errors during a normal 3-minute agent run.
