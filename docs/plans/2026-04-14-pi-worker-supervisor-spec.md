# Pi Worker Supervisor Specification

## Goal

Specify the first lightweight supervisor for Theo’s self-healing Pi worker.

This supervisor is intentionally smaller and simpler than a hosted sidecar platform. It exists to bring explicit liveness, restart, heartbeat, and health semantics to the local Linux VM worker while preserving SSH + `tmux` as the primary operator experience.

## Responsibilities

The supervisor must:

1. start Pi in a target workspace and named session context
2. detect obvious process failure
3. restart Pi with capped retries and basic backoff
4. write runtime state, heartbeat, and health markers
5. write supervisor logs to a known location
6. support graceful stop and operator-driven restart

The supervisor should **not** try to hide Pi from the operator. It should improve legibility and recovery, not replace direct observation.

## Initial Command Surface

Recommended initial interface:

```bash
pi-worker-supervisor start <session> <workspace>
pi-worker-supervisor status
pi-worker-supervisor restart <session>
pi-worker-supervisor stop <session>
```

Optional future additions:

```bash
pi-worker-supervisor tail-logs
pi-worker-supervisor checkpoint <label>
pi-worker-supervisor verify
```

## Command Semantics

## `start <session> <workspace>`

Starts or resumes supervised Pi execution for the named workspace.

Expected behavior:
- validate workspace path
- ensure state directory exists
- ensure target `tmux` session exists or create it
- launch Pi in the intended workspace if not already running
- write initial `state.json` / `health.json`
- begin heartbeat updates

## `status`

Print worker health and runtime state.

Should support:
- human-readable default output
- future `--json` machine-readable output

At minimum it should report:
- session name
- workspace path
- Pi PID if known
- daemon status
- restart count
- last heartbeat
- last success

## `restart <session>`

Restart supervised Pi for the named session.

Expected behavior:
- mark restart intent in logs/state
- stop current Pi process if present
- relaunch with same workspace/session context
- increment restart counter
- refresh health state

## `stop <session>`

Stop supervised Pi for the named session without deleting runtime state.

Expected behavior:
- stop Pi process gracefully if possible
- mark state as stopped
- stop heartbeat updates
- preserve enough metadata for inspection/restart

## Readiness Model

The first version should use a simple readiness definition.

“Healthy enough” means:
- target `tmux` session exists
- Pi process is running or was launched successfully and remains present
- supervisor can write state files
- heartbeat is updating within expected interval

The first version does **not** need deep semantic knowledge of Pi internals.

Future versions may add stronger checks such as:
- command round-trip verification
- session responsiveness checks
- stale-output detection
- gateway-facing health endpoint

## Failure Model

### Failures to detect in v1

The supervisor should detect at least:
- Pi process missing unexpectedly
- invalid workspace path
- failure to start `tmux` session
- failure to write state/heartbeat/health files

### Restart policy

Suggested first policy:
- capped restart attempts: 5
- base restart delay: 2s
- increasing delay optional after repeated failures
- operator intervention required after max restart count exceeded

### States

Suggested high-level states:
- `starting`
- `running`
- `stopped`
- `failed`
- `stale`

Definitions:
- `starting`: launch/restart in progress
- `running`: process alive and heartbeat fresh
- `stopped`: intentionally stopped by operator or clean shutdown
- `failed`: restart cap exceeded or unrecoverable startup problem
- `stale`: state exists but heartbeat too old to trust current liveness

## Logging

Supervisor should write to a known log path such as:

```text
~/.pi-worker/supervisor.log
```

Must log:
- start attempts
- stop events
- restart attempts
- failures and reasons
- state write issues

Logs should stay plain-text and SSH-friendly in the first version.

## State Integration

Supervisor is primary owner of:
- `state.json`
- `heartbeat.json`
- `health.json`
- `supervisor.log`

It may also manage checkpoint metadata under:
- `~/.pi-worker/checkpoints/`

Pi itself should not be trusted as sole owner of liveness state.

## Operator Workflow

Typical operator flow:

1. SSH into VM
2. run `pi-worker-supervisor status`
3. inspect `tmux` if needed
4. tail `~/.pi-worker/supervisor.log` if needed
5. run `pi-worker-supervisor restart <session>` if recovery required

This preserves direct operator control while reducing ambiguity.

## Non-Goals

The first supervisor version does **not** need to:
- replace `tmux`
- provide a web dashboard
- implement Telegram wake hooks
- hide all runtime details behind a gateway
- support multiple concurrent coordination writers

## Future Extensions

Later versions may add:
- JSON status output
- local HTTP health endpoint
- wake signal queue integration
- checkpoint helpers
- integration with per-task workspace sandboxes
- external gateway hooks

## Acceptance Criteria

The first supervisor milestone is successful if:
- Pi can be started reproducibly in a named session/workspace
- failure is detectable without manual guesswork
- restart count and last heartbeat are visible
- operator can restart the worker with a single command
- all relevant runtime state is legible over SSH
