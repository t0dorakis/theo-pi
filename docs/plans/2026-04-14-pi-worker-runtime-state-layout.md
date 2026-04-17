# Pi Worker Runtime State Layout

## Goal

Define the persistent runtime state layout for Theo’s supervised Pi worker so liveness, recovery, checkpoints, and operator-visible diagnostics are explicit instead of inferred from a live shell alone.

This layout is intentionally local-VM-first. It should work with SSH + `tmux` today while remaining simple enough to back a future gateway, wake-hook, or hosted control surface later.

## Root Directory

Use a dedicated runtime state directory:

```text
~/.pi-worker/
```

Recommended initial layout:

```text
~/.pi-worker/
  state.json
  heartbeat.json
  health.json
  bootstrap-version
  supervisor.log
  sessions/
  checkpoints/
  telegram/
    jobs/
  jobs/
    requests/
    results/
    leases/
```

This directory should be owned by the runtime user (`piagent`) and not require root.

## File and Directory Definitions

## `state.json`

Primary runtime state for the worker.

Suggested fields:

```json
{
  "runtimeVersion": "v1",
  "activeSessionName": "theo-pi",
  "activeWorkspacePath": "/home/piagent/workspaces/theo-pi",
  "piPid": 12345,
  "supervisorPid": 12300,
  "daemonStatus": "running",
  "restartCount": 1,
  "lastStartedAt": "2026-04-14T12:00:00Z",
  "lastRestartedAt": "2026-04-14T12:10:00Z"
}
```

Purpose:
- authoritative summary of current worker runtime state
- primary file for scripts and operator tooling
- bridge between supervisor behavior and health reporting

## `heartbeat.json`

Short-lived liveness marker.

Suggested fields:

```json
{
  "sessionName": "theo-pi",
  "workspacePath": "/home/piagent/workspaces/theo-pi",
  "lastHeartbeatAt": "2026-04-14T12:11:35Z",
  "lastSuccessAt": "2026-04-14T12:10:54Z"
}
```

Purpose:
- prove the worker is still alive enough to update state
- distinguish stale runtime from merely idle operator absence
- support future gateway/wake behavior if added later

## `health.json`

Machine-readable health summary.

Suggested fields:

```json
{
  "ok": true,
  "daemonStatus": "running",
  "sessionName": "theo-pi",
  "workspacePath": "/home/piagent/workspaces/theo-pi",
  "pid": 12345,
  "restartCount": 1,
  "lastHeartbeatAt": "2026-04-14T12:11:35Z",
  "lastSuccessAt": "2026-04-14T12:10:54Z",
  "bootstrapVersion": "2026-04-14.1"
}
```

Purpose:
- single source for health-oriented automation
- human-inspectable JSON for SSH operators
- future backing store for `pi-worker-status --json`

## `bootstrap-version`

Plain text file containing the current worker bootstrap/spec version.

Example:

```text
2026-04-14.1
```

Purpose:
- indicates which bootstrap/supervisor generation created the runtime
- helps determine whether migrations or repair steps are required

## `supervisor.log`

Append-only or rotated log for supervisor actions.

Should record at minimum:
- start attempts
- restart attempts
- detected failure reasons
- shutdown events
- state file write failures

Purpose:
- first stop for operator debugging
- forensic trace for “why did Pi restart?”

## `sessions/`

Optional session-specific runtime fragments.

Possible examples:

```text
~/.pi-worker/sessions/
  theo-pi.json
  project-x.json
```

Purpose:
- allow multiple named project sessions without overloading one global file
- preserve last-known metadata per worker session

This directory is optional for v1 but should be reserved now.

## `checkpoints/`

Checkpoint metadata and, later, lightweight backups.

Possible examples:

```text
~/.pi-worker/checkpoints/
  latest.json
  pre-self-update-2026-04-14T12-10-00Z.json
  workspace-theo-pi-2026-04-14T12-09-00Z.json
```

Purpose:
- record meaningful rollback/recovery boundaries
- make risky operations explicit
- support operator recovery after failed self-update or bad autonomous change

## `telegram/jobs/`

Transport-local job metadata for Telegram delivery state.

Possible examples:

```text
~/.pi-worker/telegram/jobs/
  2026-04-16T10-00-00Z-uuid.json
```

Purpose:
- preserve Telegram-specific queue and delivery history during transition
- track chat delivery state separately from backend-neutral runtime job contracts
- let Telegram adapter remain compatible while core queue moves into `jobs/`

## `jobs/requests/`

Canonical backend-neutral request channel.

Possible examples:

```text
~/.pi-worker/jobs/requests/
  2026-04-16T10-00-00Z-uuid.json
```

Required fields:

```json
{
  "id": "2026-04-16T10-00-00Z-uuid",
  "backendId": "tmux",
  "createdAt": "2026-04-16T10:00:00Z",
  "acceptedAt": "2026-04-16T10:00:01Z",
  "leaseOwner": "telegram-runner-1",
  "leaseExpiresAt": "2026-04-16T10:05:01Z",
  "resultChannel": "file:~/.pi-worker/jobs/results/2026-04-16T10-00-00Z-uuid.json",
  "request": {
    "prompt": "Reply with exactly: pong"
  }
}
```

Purpose:
- hold normalized prompt requests independent from transport
- give runtime core one canonical request contract
- let transports and backends coordinate through files without sharing process memory

## `jobs/results/`

Canonical backend-neutral result channel.

Possible examples:

```text
~/.pi-worker/jobs/results/
  2026-04-16T10-00-00Z-uuid.json
```

Required fields:

```json
{
  "id": "2026-04-16T10-00-00Z-uuid",
  "backendId": "tmux",
  "completedAt": "2026-04-16T10:00:30Z",
  "status": "done",
  "answer": "pong"
}
```

Failure example:

```json
{
  "id": "2026-04-16T10-00-00Z-uuid",
  "backendId": "tmux",
  "completedAt": "2026-04-16T10:05:30Z",
  "status": "failed",
  "error": "timeout waiting for answer markers after 600s"
}
```

Purpose:
- give queue, gateway, and Telegram layers one explicit result contract
- remove pane-scraping assumptions from higher layers
- preserve backend replaceability
- let only backend layer own any temporary pane parsing bridge

## `jobs/leases/`

Lease/claim metadata for queue workers.

Possible examples:

```text
~/.pi-worker/jobs/leases/
  2026-04-16T10-00-00Z-uuid.json
```

Suggested fields:

```json
{
  "id": "2026-04-16T10-00-00Z-uuid",
  "backendId": "tmux",
  "acceptedAt": "2026-04-16T10:00:01Z",
  "leaseOwner": "telegram-runner-1",
  "leaseExpiresAt": "2026-04-16T10:05:01Z",
  "resultChannel": "file:~/.pi-worker/jobs/results/2026-04-16T10-00-00Z-uuid.json"
}
```

Purpose:
- make queue claims explicit and recoverable
- support stale-lease recovery
- separate request payload from runtime claim metadata

## Update Rules

## Supervisor responsibilities

The supervisor should be the only normal writer for:
- `state.json`
- `heartbeat.json`
- `health.json`
- `supervisor.log`

It may also coordinate checkpoint metadata before risky operations.

## Pi runtime responsibilities

Pi itself should not be the primary owner of liveness files. If Pi writes anything under `~/.pi-worker/`, it should be limited to cooperative metadata that does not override the supervisor’s authority.

This is important because a crashed Pi process must not prevent the system from knowing that it is unhealthy.

## Operator responsibilities

The operator should normally read these files, not edit them by hand. Manual edits should be reserved for recovery situations and documented clearly if ever needed.

## Write Timing

Suggested timing rules:

- `state.json`
  - on startup
  - on restart
  - on session/workspace change
  - on shutdown

- `heartbeat.json`
  - at fixed interval while runtime is healthy
  - after successful prompt/run completion

- `health.json`
  - whenever relevant runtime state changes
  - after health evaluation runs

- `supervisor.log`
  - on every supervisor action and notable failure

- `checkpoints/`
  - before risky self-update
  - before risky autonomous workspace mutation
  - after successful milestone or stabilization point

- `jobs/requests/`
  - when a normalized runtime request is accepted
  - before backend execution begins

- `jobs/leases/`
  - when a worker claims a request
  - whenever lease owner or expiry changes

- `jobs/results/`
  - when backend completes or fails a request
  - whenever result payload is finalized for adapter delivery

- `telegram/jobs/`
  - when Telegram-specific delivery metadata changes
  - after final answer or failure reaches chat

## Recovery Usage

During recovery, Theo should be able to answer these questions quickly from the state layout:

1. **Is Pi currently running?**
   - check `health.json` and `state.json`

2. **Was Pi recently alive but is now stale?**
   - compare current time to `heartbeat.json`

3. **Did the worker restart recently?**
   - inspect `restartCount`, `lastRestartedAt`, and `supervisor.log`

4. **Which workspace/session was active?**
   - inspect `state.json`

5. **What safe rollback point exists?**
   - inspect `checkpoints/`

## Operational Guidance

- Keep this layout simple enough to inspect over SSH without special tooling.
- Prefer JSON for state files so they can be consumed by future scripts or gateways.
- Keep meanings stable once introduced; avoid renaming state fields casually.
- Do not hide critical state only in process memory.
- Treat this directory as runtime metadata, not as a dumping ground for unrelated artifacts.

## Future Extensions

Possible future additions:
- `wake-queue.json` for external wake/control signals
- `gateway.json` for external control plane metadata
- `metrics.json` for lightweight counters
- `locks/` for coordination if multiple helpers are added later

## Contract Notes

Reserved cross-cutting fields for request/lease/result contracts:
- `id`: canonical request id
- `backendId`: backend implementation name such as `tmux`
- `acceptedAt`: when runtime accepted request for execution
- `completedAt`: when runtime finished request
- `leaseOwner`: worker currently holding claim
- `leaseExpiresAt`: stale-lease recovery timestamp
- `resultChannel`: where higher layers should read normalized result

These fields should remain stable across transport adapters and future backends.

These are intentionally out of scope for the first milestone.
