import { createRoot } from "react-dom/client"
import { useEffect, useMemo, useState } from "react"

import "./styles.css"
import { DominoCanvas } from "./components/domino-canvas"
import type { DominoBlock } from "./components/domino-layout"
import { Sidebar } from "./components/sidebar"
import type { CollectedTraceEvent } from "../shared/protocol"
import { projectTraceSteps, type TraceStep } from "../shared/projection"
import { createTraceEventStore, useTraceEvents } from "./use-trace-events"

const params = new URLSearchParams(window.location.search)
const MOCK_LIVE = params.get("mock") === "live"
const STREAM_ID = params.get("stream")

const demoEvents: CollectedTraceEvent[] = [
  event(1, "pi-worker", "demo", "pi", "pi-worker-prompt-v1", { prompt: "Was möchte ich heute noch erledigen?" }),
  event(2, "pi-worker", "demo", "pi", "acpx-runtime-event-v1", { type: "text_delta", stream: "thought", text: "I should inspect the incoming mail and verify sender context." }),
  event(3, "pi-worker", "demo", "pi", "acpx-runtime-event-v1", { type: "tool_call", title: "Web Search", status: "completed" }),
  event(4, "pi-worker", "demo", "pi", "acpx-runtime-event-v1", { type: "tool_call", title: "Read", status: "completed" }),
  event(5, "pi-worker", "demo", "pi", "acpx-runtime-event-v1", { type: "text_delta", stream: "thought", text: "The message looks legitimate enough to create an artifact." }),
  event(6, "pi-worker", "demo", "pi", "acpx-runtime-event-v1", { type: "text_delta", stream: "output", text: "Calendar entry created." }),
  event(7, "pi-worker", "demo", "pi", "pi-worker-turn-result-v1", { status: "completed" }),
]

const livePayloads = [
  { format: "acpx-runtime-event-v1", payload: { type: "text_delta", stream: "thought", text: "Checking the next constraint before acting." } },
  { format: "acpx-runtime-event-v1", payload: { type: "tool_call", title: "Read", status: "completed" } },
  { format: "acpx-runtime-event-v1", payload: { type: "tool_call", title: "Search", status: "completed" } },
  { format: "acpx-runtime-event-v1", payload: { type: "text_delta", stream: "output", text: "Found a relevant artifact and added it to context." } },
  { format: "acpx-runtime-event-v1", payload: { type: "text_delta", stream: "thought", text: "This looks like a branch point but stays linear in mock mode." } },
  { format: "acpx-runtime-event-v1", payload: { type: "tool_call", title: "Bash", status: "completed" } },
] satisfies Array<{ format: CollectedTraceEvent["format"]; payload: unknown }>

function event(seq: number, sourceId: string, runId: string, agentId: string, format: CollectedTraceEvent["format"], payload: unknown): CollectedTraceEvent {
  return {
    streamId: `${sourceId}/${runId}/${agentId}`,
    sourceId,
    runId,
    agentId,
    seq,
    at: new Date().toISOString(),
    format,
    payload,
  }
}

const traceStore = createTraceEventStore(demoEvents)

function App() {
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [mode, setMode] = useState<"timeline" | "raw">("timeline")
  const events = useTraceEvents(traceStore)
  const steps = useMemo(() => projectTraceSteps(events), [events])
  const blocks = useMemo(() => toDominoBlocks(steps), [steps])

  useEffect(() => {
    if (!MOCK_LIVE) return
    const interval = setInterval(() => {
      const current = traceStore.getSnapshot()
      const nextSeq = current.length + 1
      const template = livePayloads[(nextSeq - demoEvents.length - 1) % livePayloads.length]
      traceStore.append(event(nextSeq, "pi-worker", "mock-live", "pi", template.format, template.payload))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!STREAM_ID) return
    traceStore.replace([])
    const encoded = encodeURIComponent(STREAM_ID)
    fetch(`/api/streams/${encoded}/snapshot`).then((response) => response.json()).then((snapshot: { events?: CollectedTraceEvent[] }) => {
      traceStore.replace(snapshot.events ?? [])
    }).catch(console.error)
    const source = new EventSource(`/api/streams/${encoded}/events`)
    source.addEventListener("snapshot", (message) => {
      const snapshot = JSON.parse((message as MessageEvent).data) as { events?: CollectedTraceEvent[] }
      traceStore.replace(snapshot.events ?? [])
    })
    source.addEventListener("event", (message) => {
      traceStore.append(JSON.parse((message as MessageEvent).data) as CollectedTraceEvent)
    })
    source.onerror = console.error
    return () => source.close()
  }, [])

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-obv-bg text-obv-ink">
      {MOCK_LIVE ? <div className="absolute right-4 top-4 z-10 border border-obv-line bg-obv-panel px-3 py-2 text-xs text-obv-muted">mock live · 1 event/s</div> : null}
      {STREAM_ID ? <div className="absolute right-4 top-4 z-10 border border-obv-line bg-obv-panel px-3 py-2 text-xs text-obv-muted">stream · {STREAM_ID}</div> : null}
      <Sidebar events={events} steps={steps} mode={mode} onModeChange={setMode} hidden={sidebarHidden} onToggleHidden={() => setSidebarHidden((value) => !value)} />
      <main className="h-full min-w-0 flex-1">
        <DominoCanvas blocks={blocks} />
      </main>
    </div>
  )
}

function toDominoBlocks(steps: TraceStep[]): DominoBlock[] {
  return steps.map((step) => {
    if (step.kind === "thought" || step.kind === "message") return { id: step.id, kind: step.kind, status: step.status, summary: step.title }
    if (step.kind === "error") return { id: step.id, kind: "error", status: "failed", summary: step.title }
    return { id: step.id, kind: "tool", status: step.status, summary: step.title }
  })
}

createRoot(document.getElementById("root")!).render(<App />)
