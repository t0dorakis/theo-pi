# SmolVM Telegram Spike Design

## Goal

Prove current Theo Pi Telegram bot flow can run against a Pi process inside SmolVM instead of current custom VM path, using a separate Telegram bot token and a guest-local workspace.

## Scope

In scope:
- reuse existing Telegram polling bot behavior and final-answer relay model
- add SmolVM-backed execution path behind current worker/runtime interface
- use a separate bot token/config so spike cannot affect current bot
- run Pi inside a guest-local workdir in SmolVM
- bootstrap guest with minimal Pi config (`settings.json` + `auth.json`)
- verify one Telegram message can round-trip to guest Pi and back
- verify failure and timeout handling

Out of scope:
- webhook mode
- host workspace mounts into SmolVM
- streaming token-by-token answers
- production hardening beyond minimal cleanup/timeouts/logging
- replacing current custom VM runtime yet

## Recommended approach

Use an adapter spike.

Keep current Telegram bot shape and message flow. Add a new SmolVM execution backend that matches existing runtime contract as closely as possible. Run host-side bot process locally with a new Telegram bot token. For each message, host code ensures a reusable warm SmolVM guest exists, stages or verifies minimal guest Pi configuration, runs Pi in guest-local workspace, captures final output, and replies to Telegram.

This gives highest-signal validation with least product churn. It proves whether existing Theo Pi bot/runtime design can talk to Pi inside SmolVM without redesigning Telegram UX or moving bot logic into guest.

## Alternatives considered

### 1. Adapter spike behind current bot/runtime interface — recommended

Pros:
- least risky
- isolates backend change
- reuses current Telegram behavior and operator expectations
- easiest comparison against current custom VM path

Cons:
- requires understanding current runtime abstraction points
- may expose coupling to current VM implementation

### 2. Run whole bot inside guest

Pros:
- fewer host/guest boundaries during execution
- conceptually simple

Cons:
- weaker operability and debugging
- does not validate existing host-managed bot architecture
- increases restart/config burden inside guest

### 3. Thin host relay shelling into guest

Pros:
- fastest throwaway spike
- small code diff

Cons:
- duplicates runtime logic
- poor long-term fit
- proves less about real integration path

## Architecture

### Host side

- existing Telegram polling bot process continues to run on host
- spike uses separate environment/config entrypoint with new bot token
- bot continues allowlist checks and final-answer relay behavior
- new SmolVM backend adapter handles VM lifecycle, guest bootstrap, command execution, and cleanup

### Guest side

- one reusable warm SmolVM guest for spike process
- guest contains Node, npm, Pi CLI, minimal Pi config, and guest-local workdir
- guest workdir is created inside guest filesystem; no host mount required
- Pi runs non-interactively for each job and returns final answer only

### Backend selection

- prefer QEMU backend on macOS for local spike
- avoid workspace mounts in first spike
- explicit VM delete preferred on failed lifecycle paths

## Component breakdown

### Telegram layer

Reuse current bot logic where possible:
- separate bot token and allowed chat config
- same command/message handling model already used for custom VM path
- same final-answer relay semantics

### SmolVM adapter

Responsibilities:
- create or reuse warm guest
- run guest preflight checks
- stage guest-local files and job inputs
- execute guest commands over ssh
- enforce timeout behavior
- fetch final output and diagnostics
- delete/recreate guest on unrecoverable state

### Guest bootstrap

Bootstrap should verify or perform:
- `node` available
- `npm` available
- `pi` CLI available
- guest `~/.config/pi/settings.json` exists with default provider/model
- guest `~/.config/pi/auth.json` exists and is readable
- guest-local base workdir exists

Minimal guest config is preferred over copying full host settings.

### Job execution

Per incoming Telegram request:
1. accept message through existing bot path
2. ensure warm SmolVM guest is healthy
3. create per-job guest directory
4. write prompt or input artifacts into guest dir if needed
5. invoke Pi in guest with stdin closed
6. capture stdout/stderr/exit status
7. return final answer to Telegram
8. keep guest warm for next job unless failure requires recycle

## Key operational findings carried into design

- guest Pi over SmolVM/SSH can hang if stdin remains attached
- non-interactive Pi calls must close stdin, e.g. `</dev/null`
- minimal guest Pi bootstrap works with local `settings.json` and copied `auth.json`
- guest-local repo/workdir works; host mount path remains unreliable for current spike
- explicit `smolvm delete <vm>` is more reliable than trusting soft stop paths after failures

## Error handling

### VM boot/create failure

- return short failure message to Telegram
- log exact failing stage: create, boot, ssh wait, preflight, or Pi run

### Guest bootstrap drift

- preflight checks gate job execution
- if bootstrap files or Pi CLI missing, attempt one repair path or fail fast with clear log

### Hung guest command

- wrap Pi call in hard timeout
- if timeout fires, terminate ssh command and mark guest unhealthy
- delete/recreate guest before next job if process state cannot be trusted

### Pi/provider auth failure

- surface short sanitized Telegram failure
- keep detailed stderr in host logs

### Cleanup failure

- prefer explicit delete on bad VM state
- do not assume graceful stop succeeded without verification

## Testing and verification

Minimum spike verification sequence:
1. boot SmolVM guest and run trivial shell command
2. verify `pi --help` in guest
3. verify authenticated guest one-shot prompt with stdin closed
4. start Telegram bot with new token/config
5. send one Telegram message and verify final answer round-trip
6. force timeout or broken command path and verify failure reply
7. run repeated jobs against warm guest and verify reuse path

Useful additional checks:
- verify no interference with current bot token/process
- verify recreated guest still answers after forced cleanup
- verify logs identify failing stage cleanly

## VM lifetime recommendation

Use one warm reusable VM per bot process for first spike.

Reasoning:
- closer to current custom VM mental model
- removes repeated bootstrap cost from each Telegram request
- keeps spike focused on Pi-in-SmolVM feasibility instead of cold-start optimization

Fallback if state becomes flaky:
- recreate VM per job or after every failure

## Success criteria

Spike is successful if all are true:
- new Telegram bot token can run without affecting current bot
- one incoming Telegram message triggers guest Pi work inside SmolVM
- bot returns guest Pi final answer back to Telegram
- guest Pi run uses guest-local workspace only
- timeout/error path produces controlled failure instead of hanging forever

## Risks

- current runtime interface may be too coupled to custom VM scripts
- guest bootstrap may be slower or more fragile than current VM
- QEMU lifecycle cleanup may require aggressive delete/recreate behavior
- Telegram bot assumptions may still depend on tmux/session semantics from old runtime

## Follow-up after successful spike

- decide whether SmolVM becomes optional backend or replacement candidate
- evaluate real repo bootstrap in guest, not only minimal workdir
- evaluate whether warm VM reuse is stable enough for longer-running sessions
- decide whether supervisor Bun core work should target backend abstraction shared by custom VM and SmolVM
