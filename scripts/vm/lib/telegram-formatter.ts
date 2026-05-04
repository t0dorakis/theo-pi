// telegram-formatter.ts
// HTML parse_mode safe — all user text escaped before insertion into HTML tags.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function formatThinking(text: string, maxChars = 200): string {
  const excerpt = text.slice(0, maxChars).replace(/\n/g, " ")
  const escaped = escapeHtml(excerpt)
  const suffix = text.length > maxChars ? "…" : ""
  return `<blockquote expandable>🤔 <i>${escaped}${suffix}</i></blockquote>`
}

export function formatToolRunning(title: string, inputSummary?: string): string {
  const escapedTitle = escapeHtml(title)
  const inputPart = inputSummary ? ` <code>${escapeHtml(inputSummary.slice(0, 80))}</code>` : ""
  return `🔧 <b>${escapedTitle}</b>${inputPart}`
}

export function formatToolDone(title: string, outputSummary?: string): string {
  const escapedTitle = escapeHtml(title)
  const outputPart = outputSummary
    ? `\n<code>${escapeHtml(outputSummary.slice(0, 200))}</code>`
    : ""
  return `✅ <b>${escapedTitle}</b>${outputPart}`
}

export function formatToolFailed(title: string, error?: string): string {
  const escapedTitle = escapeHtml(title)
  const errorPart = error ? `\n<i>${escapeHtml(error.slice(0, 100))}</i>` : ""
  return `❌ <b>${escapedTitle}</b>${errorPart}`
}

export function formatFinalAnswer(text: string): string[] {
  // Does NOT escape HTML — agent output is plain text, send without parse_mode.
  // Split at 4000 chars on newline boundaries where possible.
  const MAX = 4000
  if (text.length <= MAX) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > MAX) {
    let cutAt = remaining.lastIndexOf("\n", MAX)
    if (cutAt < MAX * 0.5) cutAt = MAX
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

export function formatTable(headers: string[], rows: string[][]): string {
  // Simulate table with monospace pre block.
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? "").length))
  )
  const sep = colWidths.map(w => "─".repeat(w + 2)).join("┼")
  const headerRow = headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join("│")
  const dataRows = rows.map(row =>
    headers.map((_, i) => ` ${(row[i] ?? "").padEnd(colWidths[i])} `).join("│")
  )
  return `<pre>${headerRow}\n${sep}\n${dataRows.join("\n")}</pre>`
}

export function formatApprovalMessage(title: string, detail?: string): string {
  const escapedTitle = escapeHtml(title)
  const detailPart = detail ? `\n\n<i>${escapeHtml(detail)}</i>` : ""
  return `⏸ <b>${escapedTitle}</b>${detailPart}`
}

export type ApprovalKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
}

export function buildApprovalKeyboard(runId: string, action = "continue"): ApprovalKeyboard {
  return {
    inline_keyboard: [[
      { text: "✅ Continue", callback_data: `approve:${runId}:${action}` },
      { text: "❌ Abort",    callback_data: `reject:${runId}:${action}` },
    ]],
  }
}

export type ParsedCallback =
  | { type: "approve" | "reject"; runId: string; action: string }
  | null

export function parseCallbackData(data: string): ParsedCallback {
  const parts = data.split(":")
  if (parts.length < 3) return null
  const [type, runId, ...actionParts] = parts
  if (type !== "approve" && type !== "reject") return null
  if (!runId) return null
  return { type: type as "approve" | "reject", runId, action: actionParts.join(":") }
}
