# Open Agents + Pi Dual-Sandbox Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Pi into `vercel-labs/open-agents` so the web app and workflow remain in Open Agents, Pi runs inside its own persistent sandbox, and Pi operates on a separate isolated work sandbox through a bridge layer.

**Architecture:** Keep `apps/web` and the durable workflow entrypoints from Open Agents. Replace the current single-sandbox `@open-harness/agent` runtime with a Pi adapter that connects two sandboxes: a persistent Pi sandbox for Pi code/config/state and a separate work sandbox for the target repo. Pi must never mutate the host app runtime directly; all agent execution happens inside the Pi sandbox, and all repo actions happen against the work sandbox through a controlled bridge.

**Tech Stack:** Next.js, Vercel Workflow, Vercel Sandbox, TypeScript, Bun, Pi (`@mariozechner/pi-coding-agent`), Open Agents monorepo packages, streaming chat API.

---

## Phase 0: Freeze target architecture and constraints

### Task 1: Write architecture decision record for dual-sandbox model

**Files:**
- Create: `docs/plans/2026-04-14-open-agents-pi-dual-sandbox-design.md`
- Reference: `README.md`
- Reference: `docs/agents/architecture.md`
- Reference: `packages/sandbox/interface.ts`

**Step 1: Draft design summary**

Write a short design doc covering:
- why Pi must run in its own sandbox
- why the work repo must stay isolated in a separate sandbox
- why local-host Pi is rejected for final architecture
- why Open Agents web/workflow layers are preserved

**Step 2: Include top-level runtime diagram**

Add this diagram to the design doc:

```text
Web -> Workflow -> Pi Sandbox -> Work Sandbox
```

**Step 3: List hard requirements**

Document these required properties:
- Pi sandbox is persistent
- work sandbox is isolated from Pi sandbox filesystem
- Pi can self-update inside Pi sandbox
- workflow can reconnect if Pi sandbox restarts
- work sandbox access only through bridge tools

**Step 4: Add non-goals**

Document these non-goals:
- no direct Pi execution on app host
- no nested Docker inside Vercel runtime
- no initial support for more than one work sandbox per chat run

**Step 5: Commit**

```bash
git add docs/plans/2026-04-14-open-agents-pi-dual-sandbox-design.md
git commit -m "docs: capture pi dual-sandbox architecture"
```

---

## Phase 1: Model dual sandbox state in Open Agents

### Task 2: Add dual-sandbox runtime types

**Files:**
- Create: `packages/shared/dual-sandbox.ts`
- Modify: `packages/shared/index.ts`
- Test: `packages/shared/dual-sandbox.test.ts`

**Step 1: Write the failing test**

Create tests for a structure like:

```ts
import { describe, expect, test } from "bun:test";
import { dualSandboxStateSchema } from "./dual-sandbox";

test("validates pi + work sandbox state", () => {
  const result = dualSandboxStateSchema.safeParse({
    pi: { type: "vercel", sandboxName: "pi-main" },
    work: { type: "vercel", sandboxName: "work-session-123" },
  });

  expect(result.success).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/shared/dual-sandbox.test.ts`
Expected: FAIL because file/module does not exist.

**Step 3: Write minimal implementation**

Add shared schema/types:
- `SandboxRole = "pi" | "work"`
- `DualSandboxState` with `pi` and `work`
- optional metadata for future bridge versioning

**Step 4: Export from shared package**

Update `packages/shared/index.ts`.

**Step 5: Run test to verify it passes**

Run: `bun test packages/shared/dual-sandbox.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/dual-sandbox.ts packages/shared/dual-sandbox.test.ts packages/shared/index.ts
git commit -m "feat: add dual sandbox shared types"
```

### Task 3: Add session-level storage shape for dual sandboxes

**Files:**
- Modify: `apps/web/lib/db/schema.ts`
- Modify: `apps/web/lib/db/sessions.ts`
- Create: `apps/web/lib/db/dual-sandbox-state.ts`
- Test: `apps/web/lib/db/dual-sandbox-state.test.ts`

**Step 1: Write the failing test**

Test parse/serialize of session sandbox state with both sandboxes present.

**Step 2: Run test to verify it fails**

Run: `bun test apps/web/lib/db/dual-sandbox-state.test.ts`
Expected: FAIL because helper does not exist.

**Step 3: Write minimal implementation**

Add helper functions to:
- read session state as dual sandbox state
- preserve backward compatibility with existing single sandbox state during migration

**Step 4: Update schema carefully**

Modify `apps/web/lib/db/schema.ts` only enough to store dual state without breaking reads of older rows.

**Step 5: Generate migration**

Run: `bun run --cwd apps/web db:generate`
Expected: new SQL migration file created.

**Step 6: Run targeted tests**

Run: `bun test apps/web/lib/db/dual-sandbox-state.test.ts`
Expected: PASS.

**Step 7: Commit**

```bash
git add apps/web/lib/db/schema.ts apps/web/lib/db/sessions.ts apps/web/lib/db/dual-sandbox-state.ts apps/web/lib/db/dual-sandbox-state.test.ts apps/web/drizzle/*.sql
git commit -m "feat: store dual sandbox session state"
```

---

## Phase 2: Reuse Open Agents sandbox package for two roles

### Task 4: Add sandbox role helpers without breaking current callers

**Files:**
- Create: `packages/sandbox/roles.ts`
- Modify: `packages/sandbox/index.ts`
- Test: `packages/sandbox/roles.test.ts`

**Step 1: Write the failing test**

Test helper output for role naming:

```ts
test("buildSandboxName namespaces by role", () => {
  expect(buildSandboxName("pi", "user-1", "session-1")).toContain("pi");
  expect(buildSandboxName("work", "user-1", "session-1")).toContain("work");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/sandbox/roles.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add helpers for:
- deterministic sandbox naming by role
- validating that pi sandbox is persistent
- validating that work sandbox may be persistent or ephemeral

**Step 4: Export helper**

Update `packages/sandbox/index.ts`.

**Step 5: Run test to verify it passes**

Run: `bun test packages/sandbox/roles.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/sandbox/roles.ts packages/sandbox/roles.test.ts packages/sandbox/index.ts
git commit -m "feat: add sandbox role helpers"
```

### Task 5: Add dual sandbox connection orchestrator

**Files:**
- Create: `packages/sandbox/connect-dual.ts`
- Modify: `packages/sandbox/index.ts`
- Test: `packages/sandbox/connect-dual.test.ts`

**Step 1: Write the failing test**

Mock `connectSandbox` and verify it connects both pi and work states.

**Step 2: Run test to verify it fails**

Run: `bun test packages/sandbox/connect-dual.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `connectDualSandbox()` that returns:

```ts
{
  piSandbox,
  workSandbox,
}
```

Rules:
- pi sandbox must connect first
- if work sandbox connection fails, pi sandbox remains available for diagnostics
- return typed object with both sandboxes

**Step 4: Export helper**

Update `packages/sandbox/index.ts`.

**Step 5: Run test to verify it passes**

Run: `bun test packages/sandbox/connect-dual.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/sandbox/connect-dual.ts packages/sandbox/connect-dual.test.ts packages/sandbox/index.ts
git commit -m "feat: add dual sandbox connector"
```

---

## Phase 3: Build work-sandbox bridge service contract

### Task 6: Define bridge protocol shared by Pi sandbox and workflow layer

**Files:**
- Create: `packages/shared/work-bridge.ts`
- Create: `packages/shared/work-bridge.test.ts`
- Modify: `packages/shared/index.ts`

**Step 1: Write the failing test**

Test schemas for commands:
- read
- write
- edit
- bash
- glob
- grep

**Step 2: Run test to verify it fails**

Run: `bun test packages/shared/work-bridge.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Define request/response Zod schemas for a minimal bridge API.

**Step 4: Export from shared package**

Update `packages/shared/index.ts`.

**Step 5: Run test to verify it passes**

Run: `bun test packages/shared/work-bridge.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/work-bridge.ts packages/shared/work-bridge.test.ts packages/shared/index.ts
git commit -m "feat: define work sandbox bridge protocol"
```

### Task 7: Implement bridge server in work sandbox runtime package

**Files:**
- Create: `packages/sandbox/work-bridge-server.ts`
- Create: `packages/sandbox/work-bridge-server.test.ts`
- Modify: `packages/sandbox/index.ts`

**Step 1: Write the failing test**

Test that a read request calls work sandbox `readFile` and returns serialized response.

**Step 2: Run test to verify it fails**

Run: `bun test packages/sandbox/work-bridge-server.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement handlers mapping protocol calls to `Sandbox` methods:
- read -> `readFile/stat`
- write -> `writeFile/mkdir/stat`
- edit -> `readFile/writeFile`
- bash -> `exec` / `execDetached`

Keep server implementation transport-agnostic if possible.

**Step 4: Export server**

Update `packages/sandbox/index.ts`.

**Step 5: Run test to verify it passes**

Run: `bun test packages/sandbox/work-bridge-server.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/sandbox/work-bridge-server.ts packages/sandbox/work-bridge-server.test.ts packages/sandbox/index.ts
git commit -m "feat: add work sandbox bridge server"
```

---

## Phase 4: Replace current agent runtime with Pi adapter

### Task 8: Create Pi adapter package skeleton

**Files:**
- Create: `packages/pi-agent/package.json`
- Create: `packages/pi-agent/tsconfig.json`
- Create: `packages/pi-agent/index.ts`
- Create: `packages/pi-agent/types.ts`
- Test: `packages/pi-agent/types.test.ts`

**Step 1: Write the failing test**

Test parse of Pi adapter options:
- pi sandbox connection info
- work bridge endpoint/config
- model selection passthrough

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/types.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Define adapter types only. Do not implement process execution yet.

**Step 4: Run test to verify it passes**

Run: `bun test packages/pi-agent/types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pi-agent/package.json packages/pi-agent/tsconfig.json packages/pi-agent/index.ts packages/pi-agent/types.ts packages/pi-agent/types.test.ts
git commit -m "feat: add pi agent package skeleton"
```

### Task 9: Implement Pi sandbox bootstrap helper

**Files:**
- Create: `packages/pi-agent/bootstrap.ts`
- Create: `packages/pi-agent/bootstrap.test.ts`
- Reference: `package.json`
- Reference: `packages/pi-caveman/APPEND_SYSTEM.md`

**Step 1: Write the failing test**

Test that bootstrap commands include:
- installing dependencies if missing
- writing Pi config files if absent
- preparing work bridge env/config

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/bootstrap.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Bootstrap helper should produce idempotent steps for Pi sandbox:
- ensure Pi binary/runtime available
- ensure config directory exists
- ensure bridge client config exists
- ensure restart marker/checkpoint path exists

**Step 4: Run test to verify it passes**

Run: `bun test packages/pi-agent/bootstrap.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pi-agent/bootstrap.ts packages/pi-agent/bootstrap.test.ts
git commit -m "feat: add pi sandbox bootstrap helper"
```

### Task 10: Implement first Pi invocation adapter

**Files:**
- Create: `packages/pi-agent/run.ts`
- Create: `packages/pi-agent/run.test.ts`
- Modify: `packages/pi-agent/index.ts`

**Step 1: Write the failing test**

Mock Pi sandbox `exec()` and assert the adapter:
- sends prompt/messages
- points Pi tools at bridge config
- returns streamed or buffered output shape

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/run.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Start with buffered execution, not full streaming.
Use one deterministic invocation path first.

**Step 4: Run test to verify it passes**

Run: `bun test packages/pi-agent/run.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pi-agent/run.ts packages/pi-agent/run.test.ts packages/pi-agent/index.ts
git commit -m "feat: add initial pi invocation adapter"
```

---

## Phase 5: Wire dual runtime into Open Agents chat setup

### Task 11: Create dual-runtime resolver for chat API

**Files:**
- Create: `apps/web/app/api/chat/_lib/dual-runtime.ts`
- Create: `apps/web/app/api/chat/_lib/dual-runtime.test.ts`
- Modify: `apps/web/app/api/chat/_lib/runtime.ts`

**Step 1: Write the failing test**

Test that runtime creation:
- connects pi sandbox
- connects work sandbox
- returns both to caller
- does not assume single sandbox

**Step 2: Run test to verify it fails**

Run: `bun test apps/web/app/api/chat/_lib/dual-runtime.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Extract current single-sandbox logic from `runtime.ts`.
Add new dual runtime function using `connectDualSandbox()`.

**Step 4: Run test to verify it passes**

Run: `bun test apps/web/app/api/chat/_lib/dual-runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/app/api/chat/_lib/dual-runtime.ts apps/web/app/api/chat/_lib/dual-runtime.test.ts apps/web/app/api/chat/_lib/runtime.ts
git commit -m "feat: add dual sandbox chat runtime"
```

### Task 12: Replace `webAgent` binding with Pi adapter binding

**Files:**
- Modify: `apps/web/app/config.ts`
- Modify: `apps/web/app/workflows/chat.ts`
- Create: `apps/web/app/workflows/pi-chat-step.ts`
- Test: `apps/web/app/workflows/pi-chat-step.test.ts`

**Step 1: Write the failing test**

Test that workflow step uses Pi adapter instead of `openHarnessAgent.stream()`.

**Step 2: Run test to verify it fails**

Run: `bun test apps/web/app/workflows/pi-chat-step.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Extract step logic behind a small interface:
- old path: AI SDK agent stream
- new path: Pi adapter run/stream

Keep message IDs and workflow metadata stable where possible.

**Step 4: Run test to verify it passes**

Run: `bun test apps/web/app/workflows/pi-chat-step.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/app/config.ts apps/web/app/workflows/chat.ts apps/web/app/workflows/pi-chat-step.ts apps/web/app/workflows/pi-chat-step.test.ts
git commit -m "feat: route workflow execution through pi adapter"
```

---

## Phase 6: Recoverability and self-healing

### Task 13: Add Pi sandbox health check and restart policy

**Files:**
- Create: `packages/pi-agent/health.ts`
- Create: `packages/pi-agent/health.test.ts`
- Modify: `apps/web/app/api/chat/_lib/dual-runtime.ts`

**Step 1: Write the failing test**

Test that unhealthy Pi sandbox triggers:
- bootstrap retry
- reconnect/restart path
- diagnostic error if recovery fails

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/health.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add health checks for:
- Pi executable available
- config dir writable
- bridge client config present
- last-start marker updated recently enough

**Step 4: Integrate into runtime**

Call health checks before chat execution.

**Step 5: Run test to verify it passes**

Run: `bun test packages/pi-agent/health.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/pi-agent/health.ts packages/pi-agent/health.test.ts apps/web/app/api/chat/_lib/dual-runtime.ts
git commit -m "feat: add pi sandbox health checks"
```

### Task 14: Add rollback/snapshot hooks for Pi sandbox updates

**Files:**
- Create: `packages/pi-agent/snapshot.ts`
- Create: `packages/pi-agent/snapshot.test.ts`
- Modify: `packages/sandbox/connect-dual.ts`

**Step 1: Write the failing test**

Test that pre-update snapshot is attempted before flagged Pi self-modifying operations.

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/snapshot.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add snapshot helpers that:
- detect snapshot capability
- store snapshot metadata
- expose rollback target in diagnostics

**Step 4: Run test to verify it passes**

Run: `bun test packages/pi-agent/snapshot.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pi-agent/snapshot.ts packages/pi-agent/snapshot.test.ts packages/sandbox/connect-dual.ts
git commit -m "feat: add pi sandbox snapshot rollback helpers"
```

---

## Phase 7: Streaming and UI compatibility

### Task 15: Add Pi-output-to-UI-message adapter

**Files:**
- Create: `packages/pi-agent/ui-stream.ts`
- Create: `packages/pi-agent/ui-stream.test.ts`
- Modify: `apps/web/app/workflows/pi-chat-step.ts`

**Step 1: Write the failing test**

Test mapping from Pi output events to `WebAgentUIMessage` chunks expected by chat UI.

**Step 2: Run test to verify it fails**

Run: `bun test packages/pi-agent/ui-stream.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Map Pi output into compatible UI chunks:
- assistant text
- tool call start/result
- finish metadata
- recoverable error surfaces

**Step 4: Run test to verify it passes**

Run: `bun test packages/pi-agent/ui-stream.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pi-agent/ui-stream.ts packages/pi-agent/ui-stream.test.ts apps/web/app/workflows/pi-chat-step.ts
git commit -m "feat: adapt pi output to open agents ui stream"
```

---

## Phase 8: End-to-end integration and deployment

### Task 16: Add a local end-to-end harness for two sandboxes

**Files:**
- Create: `scripts/dev/run-pi-dual-sandbox-smoke.sh`
- Create: `docs/plans/2026-04-14-open-agents-pi-dual-sandbox-smoke.md`
- Modify: `README.md`

**Step 1: Write the failing smoke scenario**

Document a scenario:
- start app locally
- create/connect pi sandbox
- create/connect work sandbox
- send one prompt
- verify Pi can read/edit file in work sandbox

**Step 2: Implement minimal script**

The script should:
- check env vars
- start or reconnect needed pieces
- print exact verification commands

**Step 3: Run smoke script**

Run: `bash scripts/dev/run-pi-dual-sandbox-smoke.sh`
Expected: one successful chat or a clear diagnostic failure.

**Step 4: Update README**

Add a short section linking to the smoke doc only. Do not over-document.

**Step 5: Commit**

```bash
git add scripts/dev/run-pi-dual-sandbox-smoke.sh docs/plans/2026-04-14-open-agents-pi-dual-sandbox-smoke.md README.md
git commit -m "docs: add dual sandbox smoke test flow"
```

### Task 17: Run full verification suite

**Files:**
- Modify: none
- Test: whole repo

**Step 1: Run formatting and lint checks**

Run: `bun run check`
Expected: PASS.

**Step 2: Run type checks**

Run: `turbo typecheck`
Expected: PASS.

**Step 3: Run tests**

Run: `bun test`
Expected: PASS.

**Step 4: Run CI script**

Run: `bun run ci`
Expected: PASS.

**Step 5: Capture verification notes**

Append command results and any caveats to:
- `docs/plans/2026-04-14-open-agents-pi-dual-sandbox-smoke.md`

**Step 6: Commit**

```bash
git add docs/plans/2026-04-14-open-agents-pi-dual-sandbox-smoke.md
git commit -m "chore: verify pi dual sandbox integration"
```

---

## Notes for execution

- Preserve Open Agents web/session/workflow shell as much as possible.
- Prefer adding new files over bloating existing files.
- Maintain backward compatibility with current single-sandbox session records until migration is complete.
- Do not start with full streaming if buffered execution proves the adapter contract first.
- Do not let Pi mutate host app runtime; all self-modification must happen inside Pi sandbox.
- Keep bridge protocol small first: `read`, `write`, `edit`, `bash`, `glob`, `grep`.
- Treat snapshot/rollback as required for persistent Pi sandbox, not a later nice-to-have.
- If Vercel Sandbox limits block direct Pi hosting, keep same interfaces and swap sandbox backend later rather than redesigning runtime contracts.
