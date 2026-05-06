import type { CollectedTraceEvent } from "../../shared/protocol"
import type { TraceStep } from "../../shared/projection"

type SidebarProps = {
  events: CollectedTraceEvent[]
  steps: TraceStep[]
  mode: "timeline" | "raw"
  onModeChange: (mode: "timeline" | "raw") => void
  hidden: boolean
  onToggleHidden: () => void
}

export function Sidebar({ events, steps, mode, onModeChange, hidden, onToggleHidden }: SidebarProps) {
  if (hidden) {
    return (
      <button className="absolute left-4 top-4 z-10 border border-obv-line bg-obv-panel px-3 py-2 text-sm text-obv-ink" onClick={onToggleHidden}>
        timeline
      </button>
    )
  }

  return (
    <aside className="h-full w-[360px] shrink-0 overflow-auto border-r border-obv-line bg-obv-panel p-6 text-sm text-obv-ink">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="font-bold">Trace</div>
        <button className="border border-obv-line px-2 py-1 text-obv-muted" onClick={onToggleHidden}>hide</button>
      </div>
      <div className="mb-6 flex gap-2">
        <button className={`border px-3 py-1 ${mode === "timeline" ? "border-obv-ink" : "border-obv-line text-obv-muted"}`} onClick={() => onModeChange("timeline")}>timeline</button>
        <button className={`border px-3 py-1 ${mode === "raw" ? "border-obv-ink" : "border-obv-line text-obv-muted"}`} onClick={() => onModeChange("raw")}>raw ACP</button>
      </div>
      {mode === "timeline" ? <Timeline steps={steps} /> : <Raw events={events} />}
    </aside>
  )
}

function Timeline({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="space-y-5">
      {steps.map((step) => (
        <li key={step.id}>
          <div className="mb-1 text-xs text-obv-muted">{step.kind} · {step.status} · seq {step.startSeq}{step.endSeq !== step.startSeq ? `-${step.endSeq}` : ""}</div>
          <div className={step.status === "failed" ? "break-words text-red-500" : "break-words text-obv-ink"}>{step.title}</div>
          {step.groupedStepCount ? <div className="mt-1 text-xs text-obv-muted">{step.groupedStepCount} tools · {step.rawEventCount} raw updates</div> : null}
          {!step.groupedStepCount && step.rawEventCount > 1 ? <div className="mt-1 text-xs text-obv-muted">{step.rawEventCount} raw updates coalesced</div> : null}
        </li>
      ))}
    </ol>
  )
}

function Raw({ events }: { events: CollectedTraceEvent[] }) {
  return <pre className="whitespace-pre-wrap break-words text-xs text-obv-ink">{JSON.stringify(events, null, 2)}</pre>
}

