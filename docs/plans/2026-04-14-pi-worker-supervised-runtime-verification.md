# Pi Worker Supervised Runtime Verification Checklist

## Goal

Define the verification checklist for the first supervised-runtime milestone of Theo’s self-healing Pi worker.

This milestone is successful when the worker is no longer only “a Pi process inside `tmux`,” but a supervised runtime with explicit health, heartbeat, restart semantics, and legible state.

## Operator Checks

## Access and visibility

- [ ] Theo can SSH into the VM successfully
- [ ] Theo can list `tmux` sessions successfully
- [ ] Theo can identify the active worker session quickly
- [ ] supervisor log path is known and readable

## Runtime status checks

- [ ] `pi-worker-status` or equivalent status command exists
- [ ] status command reports session name
- [ ] status command reports workspace path
- [ ] status command reports daemon status
- [ ] status command reports restart count
- [ ] status command reports last heartbeat time

## State file checks

- [ ] `~/.pi-worker/state.json` exists
- [ ] `~/.pi-worker/heartbeat.json` exists
- [ ] `~/.pi-worker/health.json` exists
- [ ] `~/.pi-worker/supervisor.log` exists
- [ ] state files contain plausible current values

## Failure Injection Checks

## Pi process kill test

- [ ] manually kill Pi process
- [ ] supervisor detects failure
- [ ] failure is visible in status output or health file
- [ ] restart count increments appropriately
- [ ] restart path is documented and reproducible

## Stale heartbeat test

- [ ] stop or suspend heartbeat updates intentionally
- [ ] worker transitions to stale or unhealthy state
- [ ] stale state is distinguishable from fully stopped state

## Broken workspace test

- [ ] point runtime at missing or invalid workspace path
- [ ] health/status reflects invalid workspace condition
- [ ] failure is logged clearly

## Checkpoint and Recovery Checks

## Runtime checkpoint checks

- [ ] checkpoint metadata location is known
- [ ] risky operation path documents when checkpoints must be created
- [ ] last checkpoint is discoverable over SSH

## Recovery checks

- [ ] Theo can determine active session/workspace from state files alone
- [ ] Theo can determine whether worker is healthy, stale, stopped, or failed from health output alone
- [ ] Theo can inspect supervisor log to understand recent restart activity

## Behavioral Checks

- [ ] Pi still works normally in workspace after supervision is added
- [ ] SSH + `tmux` remain usable and not hidden by automation
- [ ] worker remains legible during unattended operation
- [ ] supervision improves recovery without making debugging harder

## Success Criteria

The supervised-runtime milestone is successful if all of the following are true:

1. worker liveness is explicit rather than inferred
2. restart behavior is testable and repeatable
3. heartbeat and health state are machine-readable
4. operator can recover from common failures quickly over SSH
5. the architecture still remains local-VM-first and incremental

## Notes

This checklist is intentionally scoped to the first supervised local VM milestone. It does not require:
- Telegram integration
- web gateway integration
- hosted sandbox deployment
- deep runtime introspection of Pi internals

Those may come later, but the supervised runtime should stand on its own first.
