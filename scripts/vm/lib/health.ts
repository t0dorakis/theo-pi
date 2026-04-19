import type { HealthState } from "./types"
import { isOlderThan } from "./time"

export function evaluateHealth(
  state: HealthState,
  options: { now: string; staleAfterSeconds: number },
): HealthState {
  const notes = [...state.notes]
  let daemonStatus = state.daemonStatus

  if (daemonStatus === "running" && isOlderThan(state.lastHeartbeatAt, options.now, options.staleAfterSeconds)) {
    daemonStatus = "stale"
    if (!notes.includes("heartbeat stale")) {
      notes.push("heartbeat stale")
    }
  }

  return {
    ...state,
    daemonStatus,
    ok: daemonStatus === "running",
    notes,
  }
}
