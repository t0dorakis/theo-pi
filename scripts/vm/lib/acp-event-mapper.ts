type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null
}

export function acpPromptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return String(prompt ?? "").trim()
  const chunks: string[] = []
  for (const block of prompt) {
    if (!isRecord(block)) continue
    if (block.type === "text" && typeof block.text === "string") chunks.push(block.text)
    const content = block.content
    if (isRecord(content) && content.type === "text" && typeof content.text === "string") chunks.push(content.text)
  }
  return chunks.join("\n").trim()
}

export function mapGatewayEventToSessionUpdate(sessionId: string, rawEvent: unknown): AnyRecord | null {
  if (!isRecord(rawEvent)) return null
  if (rawEvent.type === "text_delta" && typeof rawEvent.text === "string") {
    return {
      sessionId,
      update: {
        sessionUpdate: rawEvent.stream === "thought" ? "agent_thought_chunk" : "agent_message_chunk",
        content: { type: "text", text: rawEvent.text },
      },
    }
  }

  // MVP intentionally forwards text-only updates. ACP tool_call mapping is
  // deferred until we normalize acpx incremental tool-call events into valid
  // ACP tool_call/tool_call_update pairs.
  return null
}

export function stopReasonFromJob(job: { status: string; error?: string | null }) {
  if (job.status === "done") return "end_turn"
  if (job.error?.toLowerCase().includes("cancel")) return "cancelled"
  return "refusal"
}
