# PR7: Telegram Rich Formatting Layer

**Branch:** `feat/pr7-telegram-rich-formatting`
**Status:** pending
**Depends on:** PR2 (`feat/pr2-acpx-streaming-telegram`)
**Estimated scope:** ~350 LOC new, ~60 LOC changed

---

## Why

`telegram-api.ts` currently sends all text with no `parse_mode`. Every message —
thinking excerpts, tool call status, final answers — arrives as a flat, unstyled
string. With even a moderately active agent run (4–8 tool calls, one thinking
block, a multi-paragraph final answer) the result is an unreadable wall of text.

Telegram Bot API HTML mode gives us:

- `<b>` bold labels for tool names and section headers
- `<i>` italic for status lines and thinking excerpts
- `<code>` inline for short inputs/outputs
- `<pre>` for structured/tabular output (no native table support)
- `<blockquote expandable>` (Bot API 7.3+, July 2024) to collapse thinking blocks
- `<tg-spoiler>` to hide sensitive content on demand
- Inline keyboards (`reply_markup`) for yes/no approval flows

None of these require server changes — only the outbound message formatting.

---

## Telegram Bot API HTML constraints

| Feature | Support |
|---|---|
| `<b>`, `<i>`, `<u>`, `<s>` | Yes |
| `<code>`, `<pre>` | Yes — monospace |
| `<a href="...">` | Yes |
| `<blockquote>` | Yes (Bot API 7.0+) |
| `<blockquote expandable>` | Yes (Bot API 7.3+, July 2024) |
| `<tg-spoiler>` | Yes (Bot API 5.4+) |
| Native table | No — simulate with `<pre>` ASCII art |
| Nested block elements | Limited — no nesting blockquote in blockquote |
| Character limit per message | 4096 chars with `parse_mode`; 4096 plain |
| HTML escaping required | Yes — `&`, `<`, `>` must be escaped in user text |

---

## New module: `scripts/vm/lib/telegram-formatter.ts`

Pure functions, zero runtime dependencies, fully unit-testable without a live bot.

### `escapeHtml(text: string): string`

Escapes `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`.
Must be applied to every piece of agent-generated or user-generated text inserted
inside an HTML-mode message. Not applied to the structural HTML tags themselves.

### `formatThinking(text, maxChars = 200): string`

```
<blockquote expandable>🤔 <i>{escaped excerpt}…</i></blockquote>
```

- Truncates to `maxChars` (default 200) and appends `…` when truncated.
- Collapses newlines to spaces inside the excerpt (blockquote line breaks look odd at short lengths).
- Uses `expandable` so Telegram collapses the block by default; user taps to expand.
- Rationale: openclaw issue #7066 — thinking/reasoning blocks should be visible but not dominant.

### `formatToolRunning(title, inputSummary?): string`

```
🔧 <b>{title}</b> <code>{input truncated to 80}</code>
```

Shown while a tool call is `in_progress`. Input summary is optional; omitted if the
tool has no meaningful short-form input (e.g. a tool with a 10 KB JSON body).

### `formatToolDone(title, outputSummary?): string`

```
✅ <b>{title}</b>
<code>{output truncated to 200}</code>
```

Replaces the `formatToolRunning` message (via `editMessageText`) once the call
completes. Output summary is optional.

### `formatToolFailed(title, error?): string`

```
❌ <b>{title}</b>
<i>{error truncated to 100}</i>
```

Replaces the running message on tool error.

### `formatFinalAnswer(text: string): string[]`

- Does **not** escape HTML. The agent's final answer is plain text output; it is
  sent without `parse_mode` to avoid false-positive tag interpretation.
- Splits at 4000-char boundaries, preferring `\n` split points within the last 50%
  of the chunk window to avoid mid-sentence cuts.
- Returns `string[]` — caller sends each chunk as a separate message.

### `formatTable(headers: string[], rows: string[][]): string`

Renders an ASCII table wrapped in `<pre>` for monospace display:

```
<pre> Col A │ Col B │ Col C
──────────┼───────┼──────
 row1a    │ row1b │ row1c</pre>
```

Column widths are computed from the max of header and all row values.
Box-drawing characters (`│`, `─`, `┼`) are used for visual clarity.

### `formatApprovalMessage(title, detail?): string`

```
⏸ <b>{title}</b>

<i>{detail}</i>
```

Used to precede an inline keyboard approval prompt.

### `buildApprovalKeyboard(runId, action = "continue"): ApprovalKeyboard`

Returns a `reply_markup`-compatible object:

```json
{
  "inline_keyboard": [[
    { "text": "✅ Continue", "callback_data": "approve:{runId}:{action}" },
    { "text": "❌ Abort",    "callback_data": "reject:{runId}:{action}"  }
  ]]
}
```

`runId` is the job/turn identifier. `action` is a string naming what is being
approved (e.g. `"continue"`, `"exec:rm -rf /tmp/foo"`). The `callback_data` format
`type:runId:action` allows `action` itself to contain colons.

### `parseCallbackData(data: string): ParsedCallback`

Parses a `callback_query.data` string into `{ type, runId, action }`.
Returns `null` for malformed input. Handles `action` values that contain colons.

---

## Updates to `telegram-api.ts`

### `sendMessage` — add `parse_mode` and `reply_markup` support

```typescript
async function sendMessage(
  chatId: number,
  text: string,
  options?: {
    parseMode?: "HTML" | "Markdown" | "MarkdownV2"
    replyMarkup?: unknown
    disableWebPagePreview?: boolean
  }
)
```

- `parse_mode` defaults to absent (plain text) — safe default, opt-in for HTML.
- `reply_markup` forwarded verbatim when present.
- Chunking retained for long messages; `parse_mode` applied to each chunk.

### `editMessageText` — add `parse_mode` support

Same optional `parseMode` parameter added.

### New: `answerCallbackQuery(callbackQueryId, text?)`

Required acknowledgement when the bot receives a `callback_query`. Telegram shows
a loading spinner on the button until this is called (max 10 s timeout).

```typescript
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>
```

### New: `sendMessageWithKeyboard(chatId, text, keyboard, parseMode?)`

Convenience wrapper:

```typescript
async function sendMessageWithKeyboard(
  chatId: number,
  text: string,
  keyboard: ApprovalKeyboard,
  parseMode?: "HTML"
): Promise<number>  // returns message_id
```

Returns `message_id` so the caller can later `editMessageText` to replace the
keyboard with a result (e.g. "✅ Approved" or "❌ Aborted").

---

## Updates to streaming delivery (PR2 integration)

`StreamingTelegramDelivery` (introduced in PR2) is updated to use the formatter:

| Event | Before | After |
|---|---|---|
| `text_delta` (thought) | raw excerpt | `formatThinking(excerpt)` with `parse_mode: "HTML"` |
| `tool_call in_progress` | plain "Running: X" | `formatToolRunning(title, input)` HTML |
| `tool_call completed` | plain "Done: X" | `formatToolDone(title, output)` HTML |
| `tool_call failed` | plain error | `formatToolFailed(title, error)` HTML |
| `turn.result completed` | plain text chunks | `formatFinalAnswer(text)` → chunks, no parse_mode |
| `turn.result failed` | plain error | `<b>Error</b>\n<code>...</code>` HTML |

Throttle logic from PR2 (one edit per 1 500 ms) is unchanged.

---

## Callback query flow for approvals (tie-in with PR5)

PR5 introduces checkpoint gates (pause-before-exec). Rather than requiring the user
to type `/continue` or `/abort` as text commands, PR7 makes those gates use inline
keyboards.

**Flow:**

1. Agent hits a checkpoint gate (e.g. before running a shell command).
2. `StreamingTelegramDelivery` calls `sendMessageWithKeyboard(chatId, approvalText, buildApprovalKeyboard(runId))`.
3. User taps ✅ Continue or ❌ Abort.
4. `telegram-poller.ts` receives `callback_query` with `data = "approve:{runId}:continue"` or `"reject:{runId}:continue"`.
5. Bot calls `answerCallbackQuery(callbackQueryId)` immediately (clears spinner).
6. Bot routes parsed callback to the gate resolver for `runId`.
7. Gate resolver unblocks the run (approve) or cancels it (reject).
8. Bot edits the keyboard message to show the resolved state (replaces buttons with "✅ Approved" text).

This replaces the text-command polling loop for approvals, making it instant and
impossible to accidentally approve the wrong run by typing `/continue` at the wrong moment.

---

## Test strategy

### Unit tests — `scripts/vm/lib/telegram-formatter.test.ts`

- **`escapeHtml`**: `&`, `<`, `>` individually and combined.
- **`formatThinking`**: no truncation at exactly `maxChars`, truncation with `…` appended,
  newlines collapsed to spaces, `expandable` attribute present.
- **`formatToolRunning`**: icon, bold title, optional code block, title escaping.
- **`formatToolDone`**: icon, title, optional output block, output truncation at 200.
- **`formatToolFailed`**: icon, italic error, error truncation at 100.
- **`formatFinalAnswer`**: single chunk ≤ 4000, two chunks at boundary, prefers `\n` split.
- **`formatTable`**: column width calculation, `│`/`─`/`┼` characters, wrapped in `<pre>`.
- **`buildApprovalKeyboard`**: correct `callback_data` format for both buttons.
- **`parseCallbackData`**: approve, reject, action with colons, too few parts → null,
  unknown type → null, empty runId → null.

### Integration smoke test (manual, no live bot required)

- Construct a fake sequence of events (thinking, 2 tool calls, final answer).
- Feed through formatter functions, assert no unescaped `<` or `>` in HTML segments.
- Assert `formatFinalAnswer` output has no `parse_mode` markers.

### Mock API test

- Stub `fetchImpl` in `createTelegramApi`.
- Call `sendMessage` with `parseMode: "HTML"` → assert `parse_mode: "HTML"` in request body.
- Call `answerCallbackQuery` → assert correct method and `callback_query_id` in body.

---

## Out of scope for PR7

- Server-side storage of pending approvals (PR5 owns the gate resolver).
- Telegram webhook mode (PR7 works with long-polling, PR2's model).
- Image/file attachments.
- Message threading / reply_to_message_id (deferred).
- `MarkdownV2` mode — HTML is strictly better for our use case.
