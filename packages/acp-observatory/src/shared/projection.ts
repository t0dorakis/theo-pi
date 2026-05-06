import type { CollectedTraceEvent } from "./protocol"

export type StepStatus = "pending" | "in_progress" | "completed" | "failed"

export type TraceStepKind = "thought" | "message" | "tool" | "error"

export type TraceStep = {
  id: string
  kind: TraceStepKind
  status: StepStatus
  title: string
  startSeq: number
  endSeq: number
  rawEventCount: number
  rawEvents: CollectedTraceEvent[]
  toolName?: string
  detail?: string
  groupedStepCount?: number
  groupedSteps?: TraceStep[]
}

type CanonicalPayload = Record<string, unknown> & {
  type?: string
  stream?: unknown
  text?: unknown
  status?: unknown
  toolCallId?: unknown
  title?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function payloadOf(event: CollectedTraceEvent) {
  return isRecord(event.payload) ? event.payload : {}
}

function canonicalPayloadOf(event: CollectedTraceEvent): CanonicalPayload {
  const payload = payloadOf(event)
  const update = isRecord(payload.update) ? payload.update : payload
  const tag = typeof update.sessionUpdate === "string" ? update.sessionUpdate : undefined

  if (tag === "agent_thought_chunk" || tag === "agent_message_chunk") {
    const content = isRecord(update.content) ? update.content : {}
    return {
      ...update,
      type: "text_delta",
      stream: tag === "agent_thought_chunk" ? "thought" : "output",
      text: typeof content.text === "string" ? content.text : update.text,
    }
  }

  if (tag === "tool_call" || tag === "tool_call_update") return { ...update, type: "tool_call" }
  return update
}

function statusOf(value: unknown): StepStatus {
  if (value === "failed" || value === "error" || value === "cancelled" || value === "canceled") return "failed"
  if (value === "in_progress" || value === "running") return "in_progress"
  if (value === "completed" || value === "done" || value === "success") return "completed"
  if (value === "pending") return "pending"
  return "pending"
}

function isUsefulToolTitle(title: string) {
  const normalized = title.trim().toLowerCase()
  return normalized.length > 0 && normalized !== "tool call" && !normalized.startsWith("tool call (")
}

function compactText(input: string) {
  return input.replace(/\s+/g, " ").trim()
}

function baseToolName(input: string) {
  const normalized = compactText(input).toLowerCase()
  if (!normalized) return "tool"
  return normalized.split(/[\s(:·]/)[0] || "tool"
}

function toolInput(payload: Record<string, unknown>) {
  for (const key of ["input", "args", "arguments", "params", "rawInput", "toolInput"]) {
    const value = payload[key]
    if (isRecord(value)) return value
  }
  return {}
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function detailForTool(payload: Record<string, unknown>) {
  const input = toolInput(payload)
  const path = firstString(input, ["path", "file", "filePath", "filepath", "absolutePath", "relativePath"])
  if (path) return basename(path)
  const query = firstString(input, ["query", "pattern", "regex", "q"])
  if (query) return query.slice(0, 80)
  const command = firstString(input, ["command", "cmd", "script"])
  if (command) return command.replace(/\s+/g, " ").slice(0, 80)
  return undefined
}

function titleForTool(payload: Record<string, unknown>, fallback: string) {
  const title = typeof payload.title === "string" ? payload.title : ""
  const text = typeof payload.text === "string" ? payload.text : ""
  const name = firstString(payload, ["name", "toolName", "kind"]) ?? (isUsefulToolTitle(title) ? title : text.includes("(") ? text.slice(0, text.indexOf("(")) : fallback)
  const toolName = baseToolName(name)
  const detail = detailForTool(payload)
  return detail ? `${toolName} · ${detail}` : toolName
}

function titleFromText(input: string, fallback: string) {
  const text = compactText(input)
  const heading = text.match(/^\*\*([^*]{3,96})\*\*/)?.[1]
  if (heading) return heading
  const firstSentence = text.match(/^(.{16,160}?[.!?])(?:\s|$)/)?.[1]
  return (firstSentence ?? text).slice(0, 120) || fallback
}

function makeStep(event: CollectedTraceEvent, kind: TraceStepKind, title: string, status: StepStatus): TraceStep {
  return {
    id: `${event.streamId}:${kind}:${event.seq}`,
    kind,
    title,
    status,
    startSeq: event.seq,
    endSeq: event.seq,
    rawEventCount: 1,
    rawEvents: [event],
  }
}

function appendRaw(step: TraceStep, event: CollectedTraceEvent) {
  step.endSeq = event.seq
  step.rawEventCount += 1
  step.rawEvents.push(event)
}

type TextRun = {
  stream: "thought" | "output"
  events: CollectedTraceEvent[]
  text: string
}

function flushTextRun(steps: TraceStep[], run: TextRun | null, isLiveTail: boolean) {
  if (!run || run.events.length === 0) return
  const kind: TraceStepKind = run.stream === "thought" ? "thought" : "message"
  const chunks = splitTextIntoSteps(run.text, run.stream)
  const perChunk = Math.max(1, Math.ceil(run.events.length / chunks.length))
  for (const [index, text] of chunks.entries()) {
    const rawEvents = run.events.slice(index * perChunk, index === chunks.length - 1 ? run.events.length : (index + 1) * perChunk)
    const first = rawEvents[0] ?? run.events[0]
    const step = makeStep(first, kind, titleFromText(text, kind), isLiveTail && index === chunks.length - 1 ? "in_progress" : "completed")
    step.rawEvents = rawEvents.length > 0 ? rawEvents : [first]
    step.rawEventCount = step.rawEvents.length
    step.endSeq = step.rawEvents.at(-1)?.seq ?? step.startSeq
    steps.push(step)
  }
}

function splitTextIntoSteps(text: string, stream: TextRun["stream"]) {
  const normalized = text.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []
  if (stream === "output") return [normalized]

  const chunks: string[] = []
  const headingPattern = /(?=\n?\*\*[^*\n]{3,96}\*\*)/g
  const headingParts = normalized.split(headingPattern).map((part) => part.trim()).filter(Boolean)
  const parts = headingParts.length > 1 ? headingParts : normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)

  for (const part of parts) {
    if (part.length <= 800) {
      chunks.push(part)
      continue
    }
    for (let start = 0; start < part.length; start += 800) chunks.push(part.slice(start, start + 800).trim())
  }

  return chunks.length > 0 ? chunks : [normalized]
}

function statusRank(status: StepStatus) {
  if (status === "failed") return 4
  if (status === "in_progress") return 3
  if (status === "pending") return 2
  return 1
}

function aggregateStatus(steps: TraceStep[]) {
  return steps.reduce((winner, step) => statusRank(step.status) > statusRank(winner) ? step.status : winner, "completed" as StepStatus)
}

function isGroupableTool(step: TraceStep) {
  return step.kind === "tool" && step.status !== "failed" && ["read", "grep", "find_files"].includes(step.toolName ?? "")
}

function groupTitle(toolName: string, steps: TraceStep[]) {
  const details = [...new Set(steps.map((step) => step.detail).filter((value): value is string => !!value))]
  if (details.length === 1) return `${toolName} ×${steps.length} · ${details[0]}`
  if (details.length > 1 && details.length <= 3) return `${toolName} ×${steps.length} · ${details.join(", ")}`
  return `${toolName} ×${steps.length}`
}

function groupToolBursts(steps: TraceStep[]) {
  const grouped: TraceStep[] = []
  let burst: TraceStep[] = []

  const flush = () => {
    if (burst.length === 0) return
    if (burst.length === 1) grouped.push(burst[0])
    else {
      const first = burst[0]
      const rawEvents = burst.flatMap((step) => step.rawEvents)
      grouped.push({
        ...first,
        id: `${first.id}:group-${burst.length}`,
        title: groupTitle(first.toolName ?? first.title, burst),
        status: aggregateStatus(burst),
        endSeq: burst.at(-1)!.endSeq,
        rawEventCount: rawEvents.length,
        rawEvents,
        groupedStepCount: burst.length,
        groupedSteps: burst,
      })
    }
    burst = []
  }

  for (const step of steps) {
    if (!isGroupableTool(step)) {
      flush()
      grouped.push(step)
      continue
    }
    if (burst.length > 0 && burst[0].toolName !== step.toolName) flush()
    burst.push(step)
  }
  flush()
  return grouped
}

export function projectTraceSteps(events: CollectedTraceEvent[]): TraceStep[] {
  const steps: TraceStep[] = []
  const tools = new Map<string, TraceStep>()
  let textRun: TextRun | null = null

  const flush = (nextEvent?: CollectedTraceEvent) => {
    flushTextRun(steps, textRun, !nextEvent && textRun?.events.at(-1) === events.at(-1))
    textRun = null
  }

  for (const event of events) {
    const payload = canonicalPayloadOf(event)

    if (payload.type === "text_delta") {
      const stream = payload.stream === "thought" ? "thought" : "output"
      const text = typeof payload.text === "string" ? payload.text : ""
      if (textRun && textRun.stream !== stream) flush(event)
      textRun ??= { stream, events: [], text: "" }
      textRun.events.push(event)
      textRun.text += text
      continue
    }

    flush(event)

    if (event.format === "pi-worker-session-error-v1" || event.format === "pi-worker-turn-exception-v1" || event.format === "pi-worker-retry-error-v1") {
      steps.push(makeStep(event, "error", event.format, "failed"))
      continue
    }

    if (event.format === "pi-worker-turn-result-v1") {
      if (statusOf(payload.status) === "failed") steps.push(makeStep(event, "error", "turn failed", "failed"))
      continue
    }

    if (payload.type === "tool_call") {
      const rawId = typeof payload.toolCallId === "string" ? payload.toolCallId : String(event.seq)
      const id = `${event.streamId}:tool:${rawId}`
      const status = statusOf(payload.status)
      const existing = tools.get(id)
      if (existing) {
        appendRaw(existing, event)
        existing.status = status
        const nextTitle = titleForTool(payload, existing.title)
        if (isUsefulToolTitle(nextTitle) && !isUsefulToolTitle(existing.title)) existing.title = nextTitle
      } else {
        const title = titleForTool(payload, "tool")
        const step = makeStep(event, "tool", title, status)
        step.id = id
        step.toolName = baseToolName(title)
        step.detail = detailForTool(payload)
        tools.set(id, step)
        steps.push(step)
      }
    }
  }

  flush()
  return groupToolBursts(steps.sort((left, right) => left.startSeq - right.startSeq))
}
