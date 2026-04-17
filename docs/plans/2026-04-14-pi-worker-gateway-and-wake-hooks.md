# Pi Worker Gateway and Wake-Hook Placeholder

## Goal

Reserve an explicit architecture slot for future external control surfaces such as Telegram, web, or scriptable APIs without making them blockers for the SSH-first local VM worker.

This placeholder is informed primarily by ClawRun’s wake-hook and channel model. It exists so future channel work lands in the right place rather than getting embedded directly into Pi runtime logic.

## Current Non-Goal

The first milestone for Theo’s worker is **not** to ship a Telegram bot, web dashboard, or full HTTP control plane.

The first milestone remains:
- local Linux VM
- SSH + `tmux`
- supervised Pi runtime
- explicit health and heartbeat state

## Reserved Future Layers

When external control surfaces are added later, the architecture should include distinct layers for:

1. **validators**
   - verify incoming webhook or request authenticity

2. **wake hooks**
   - transform incoming external events into normalized wake/control signals

3. **gateway**
   - receive requests from external clients
   - route them to runtime-core APIs and explicit job/result contracts
   - return status or results

4. **runtime control plane**
   - start, wake, or inspect Pi runtime
   - avoid coupling external protocol details to Pi internals

## Expected Future Flow

A future Telegram-style flow should look like:

```text
Telegram webhook -> validator -> wake hook -> gateway -> runtime API -> execution backend -> Pi
```

Not:

```text
Telegram code -> direct shell bridge -> Pi process manipulation
```

This separation keeps channels replaceable and reduces risk of control-path sprawl inside Pi runtime code.

## Likely First Gateway Shape

When Theo does add a gateway, simplest useful shape should be runtime-API-first rather than shell-bridge-first:

### `POST /run`
Submit one prompt or command to the worker.

### `GET /health`
Return machine-readable worker health.

These two endpoints are enough for first proof-of-concept and should call shared runtime APIs rather than inline shell orchestration.

## Expected Signal Shape

Future wake/control signals should be normalized so the runtime does not care whether they came from Telegram, web, or another channel.

Possible conceptual fields:
- source channel
- user or chat identity
- message text or action payload
- correlation ID
- timestamp

This is only a placeholder and should not yet be treated as a full API design.

## Why Reserve This Now

Even though Theo does not need a gateway immediately, naming the architecture slot now prevents future mistakes such as:
- embedding Telegram handling directly into Pi startup scripts
- letting web/API logic own runtime restart policy
- mixing validation, wake, and execution logic in one process

## Relationship to SSH-First Operations

SSH + `tmux` remain the primary operator interface for the near term.

Future gateways should be:
- additive
- optional
- subordinate to the supervised runtime model

They should not replace direct operator visibility until the worker runtime is already trustworthy.

## Non-Goals

This placeholder does **not** define:
- a production Telegram integration
- a complete REST API
- a streaming response protocol
- authentication details for every future channel

## Acceptance Criteria

This placeholder is successful if future channel work has a clearly reserved place in the architecture and does not force redesign of the supervised local worker.
