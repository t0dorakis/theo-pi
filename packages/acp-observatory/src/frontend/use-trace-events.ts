import { useCallback, useSyncExternalStore } from "react"

import type { CollectedTraceEvent } from "../shared/protocol"

type TraceEventStore = {
  append: (event: CollectedTraceEvent) => void
  replace: (events: CollectedTraceEvent[]) => void
  getSnapshot: () => CollectedTraceEvent[]
  subscribe: (listener: () => void) => () => void
}

export function createTraceEventStore(initialEvents: CollectedTraceEvent[] = []): TraceEventStore {
  let events = initialEvents
  const listeners = new Set<() => void>()

  return {
    append(event) {
      events = [...events, event]
      for (const listener of listeners) listener()
    },
    replace(nextEvents) {
      events = nextEvents
      for (const listener of listeners) listener()
    },
    getSnapshot() {
      return events
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useTraceEvents(store: TraceEventStore) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store])
  const getSnapshot = useCallback(() => store.getSnapshot(), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
