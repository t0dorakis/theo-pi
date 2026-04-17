import { expect, test } from "bun:test"

import type { HealthState } from "./types"
import { evaluateHealth } from "./health"

test("marks running heartbeat as healthy", () => {
  const state: HealthState = {
    ok: false,
    daemonStatus: "running",
    sessionName: "theo-pi",
    workspacePath: "/tmp/workspace",
    pid: 123,
    restartCount: 1,
    lastHeartbeatAt: "2026-04-16T10:00:00Z",
    lastSuccessAt: "2026-04-16T10:00:00Z",
    bootstrapVersion: "2026-04-16.1",
    notes: [],
  }

  expect(
    evaluateHealth(state, {
      now: "2026-04-16T10:00:30Z",
      staleAfterSeconds: 300,
    }),
  ).toMatchObject({ ok: true, daemonStatus: "running" })
})

test("marks stale heartbeat as unhealthy", () => {
  const state: HealthState = {
    ok: true,
    daemonStatus: "running",
    sessionName: "theo-pi",
    workspacePath: "/tmp/workspace",
    pid: 123,
    restartCount: 1,
    lastHeartbeatAt: "2026-04-16T10:00:00Z",
    lastSuccessAt: "2026-04-16T10:00:00Z",
    bootstrapVersion: "2026-04-16.1",
    notes: [],
  }

  expect(
    evaluateHealth(state, {
      now: "2026-04-16T10:10:30Z",
      staleAfterSeconds: 300,
    }),
  ).toMatchObject({ ok: false, daemonStatus: "stale", notes: ["heartbeat stale"] })
})
