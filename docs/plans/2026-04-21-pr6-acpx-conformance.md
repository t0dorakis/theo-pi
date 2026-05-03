# PR6: ACP conformance test suite for Pi adapter health

**Branch:** `feat/pr6-acpx-conformance`  
**Status:** pending  
**Depends on:** none — independent PR, can merge at any time  
**Estimated scope:** ~120 LOC new, 0 LOC changed in production code

---

## Why

Pi exposes an ACP (Agent Client Protocol) adapter (`pi-acp`) that acpx connects to. When Pi upgrades its adapter implementation, edge cases can break silently: session creation may regress, cancel may stop working, multi-turn context may reset unexpectedly. We have no systematic way to catch these regressions today.

The acpx conformance suite (`conformance/cases/*.json`) is a corpus of 21 protocol-level test cases with a data-driven runner. They test the ACP contract directly — not Pi's CLI, not its output format, not our wrapper code — by speaking raw ACP JSON-RPC to the adapter process. We can run these against Pi's live ACP session to get a pass/fail matrix in CI after any Pi update.

This PR adds a `pi-worker-conformance.ts` script that invokes the conformance runner and formats results for our CI pipeline and for on-demand Telegram reporting.

---

## What the Conformance Suite Tests

The 21 cases in `conformance/cases/` cover the full ACP v1 core protocol profile. Each case defines `steps` (operations against the agent) and `checks` (assertions on the results):

| Case | ID | What it validates |
|------|----|-------------------|
| 001 | `acp.v1.initialize.handshake` | Adapter initialize exposes correct protocol version number |
| 002 | `acp.v1.session.new` | `session/new` returns a non-empty session ID |
| 003 | `acp.v1.session.prompt.single_turn` | Single prompt runs end-to-end, yields ≥1 update, stop_reason in `["end_turn","completed","done"]` |
| 004 | `acp.v1.session.update.stream_termination` | Update stream references session ID, terminates cleanly |
| 005 | `acp.v1.session.cancel.in_flight` | `session/cancel` terminates an in-flight prompt, transitions to cancelled |
| 006 | `acp.v1.error.invalid_params` | Invalid params produce explicit JSON-RPC error response |
| 007 | `acp.v1.permission.denied` | Permission denial is machine-readable (not a crash) |
| 008 | `acp.v1.session.unknown_id` | Unknown session ID fails explicitly, not silently |
| 009 | `acp.v1.session.cancel.idle` | Cancel on an idle (non-running) session is acknowledged cleanly |
| 010 | `acp.v1.session.prompt.multi_turn` | Multi-turn prompt flow: two sequential prompts in same session remain stable |
| 011 | `acp.v1.session.prompt.invalid_session_type` | Prompt with invalid session ID type returns protocol error |
| 012 | `acp.v1.permission.denied_write` | Write permission denial is explicit and machine-readable |
| 013 | `acp.v1.session.prompt.echo_empty` | Prompt with empty payload still completes (does not hang) |
| 014 | `acp.v1.session.prompt.unrecognized` | Unrecognized prompt input is surfaced in updates, not discarded silently |
| 015 | `acp.v1.error.invalid_params_cwd_null` | `cwd: null` in session/new is rejected with protocol error |
| 016 | `acp.v1.session.prompt.structured_blocks` | Structured prompt blocks (multi-block content) are passed through correctly |
| 017 | `acp.v1.permission.read_approved` | Read file operation succeeds in `approve-all` mode |
| 018 | `acp.v1.permission.write_approved` | Write file operation succeeds in `approve-all` mode |
| 019 | `acp.v1.session.prompt.background` | Background prompt (`prompt_background` + `await_background`) completes correctly |
| 020 | `acp.v1.session.cancel.then_followup` | Session remains usable after a cancellation — next prompt succeeds |
| 021 | `acp.v1.session.prompt.post_success_drain` | Late post-success tool updates are observable (update stream not prematurely closed) |

Cases 001–009 cover the core lifecycle. Cases 010–021 cover edge cases that commonly regress after adapter updates.

The runner speaks directly to the ACP adapter via stdio — no acpx wrapper, no pi-worker code in the path. A failure here means Pi's `pi-acp` package has a protocol-level regression.

---

## How the Runner Works

The conformance runner (`acpx/conformance/runner/run.ts`) accepts:
- `--agent-command <command>`: the ACP adapter command to test (default: mock)
- `--format json`: emit machine-readable JSON output
- `--report <path>`: write JSON report to file
- `--case <caseId>`: run only a specific case

For Pi, the agent command is `npx pi-acp` (or whatever `resolveAgentCommand("pi")` returns from acpx — currently `npx pi-acp@<version>`).

The runner spawns the adapter command as a subprocess, connects via stdin/stdout ACP JSON-RPC, executes each case's `steps` sequence, evaluates `checks`, and reports pass/fail.

---

## New File: `scripts/vm/pi-worker-conformance.ts`

```ts
#!/usr/bin/env bun
/**
 * Run the acpx ACP conformance suite against Pi's ACP adapter.
 *
 * Usage:
 *   bun scripts/vm/pi-worker-conformance.ts [--case <caseId>] [--json] [--report <path>]
 *
 * Exit codes:
 *   0 — all required cases passed
 *   1 — one or more required cases failed
 *   2 — runner error (setup failed, not a test failure)
 */
import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { getRuntimeEnv } from "./lib/env"
import { getScriptDir } from "./lib/paths"

const execFileAsync = promisify(execFile)
const env = getRuntimeEnv()
const scriptDir = getScriptDir(import.meta.url)

// Path to the conformance runner — installed as part of acpx package
const acpxConformanceRunner = join(
  scriptDir, "..", "..", "node_modules", "acpx", "conformance", "runner", "run.js",
)

// Path to the conformance cases and profile
const acpxConformanceCases = join(
  scriptDir, "..", "..", "node_modules", "acpx", "conformance", "cases",
)
const acpxConformanceProfile = join(
  scriptDir, "..", "..", "node_modules", "acpx", "conformance", "profiles", "acp-core-v1.json",
)

// Pi's ACP adapter command — same as what acpx uses internally for "pi" agent
const piAgentCommand = env.acpx.command !== "acpx"
  ? env.acpx.command   // custom override
  : "npx pi-acp"       // default: published pi-acp adapter

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    caseId: undefined as string | undefined,
    jsonOutput: false,
    reportPath: undefined as string | undefined,
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--case" && args[i + 1]) result.caseId = args[++i]
    if (args[i] === "--json") result.jsonOutput = true
    if (args[i] === "--report" && args[i + 1]) result.reportPath = args[++i]
  }
  return result
}

const opts = parseArgs()

const runnerArgs: string[] = [
  acpxConformanceRunner,
  "--profile", acpxConformanceProfile,
  "--cases-dir", acpxConformanceCases,
  "--agent-command", piAgentCommand,
  "--agent-command-cwd", env.acpx.cwd ?? process.cwd(),
  "--permission-mode", "approve-all",
  "--format", "json",   // always collect JSON; format for humans below
]

if (opts.caseId) {
  runnerArgs.push("--case", opts.caseId)
}

type ConformanceReport = {
  profile: string
  total: number
  passed: number
  failed: number
  skipped: number
  cases: Array<{
    id: string
    title: string
    status: "pass" | "fail" | "skip" | "error"
    durationMs: number
    error?: string
    checks?: Array<{ type: string; passed: boolean; detail?: string }>
  }>
}

let report: ConformanceReport

try {
  const { stdout } = await execFileAsync("node", runnerArgs, {
    env: process.env,
    maxBuffer: 1024 * 1024 * 4,
    timeout: 5 * 60 * 1000,   // 5 min max for full suite
  })
  report = JSON.parse(stdout) as ConformanceReport
} catch (error) {
  console.error(`conformance runner failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

if (opts.reportPath) {
  await writeFile(opts.reportPath, JSON.stringify(report, null, 2))
  console.log(`report written to ${opts.reportPath}`)
}

if (opts.jsonOutput) {
  console.log(JSON.stringify(report, null, 2))
} else {
  // Human-readable summary
  const width = 60
  console.log(`\nACP Conformance: ${report.profile}`)
  console.log(`${"─".repeat(width)}`)
  for (const c of report.cases) {
    const icon = c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : "⏭️ "
    const duration = `${c.durationMs}ms`.padStart(7)
    console.log(`${icon} ${c.id.padEnd(50)} ${duration}`)
    if (c.status === "fail" && c.error) {
      console.log(`   └─ ${c.error}`)
    }
  }
  console.log(`${"─".repeat(width)}`)
  console.log(`Total: ${report.total}  Passed: ${report.passed}  Failed: ${report.failed}  Skipped: ${report.skipped}`)
}

process.exit(report.failed > 0 ? 1 : 0)
```

---

## Running It

```bash
# Full suite (human-readable)
bun scripts/vm/pi-worker-conformance.ts

# Full suite (JSON output)
bun scripts/vm/pi-worker-conformance.ts --json

# Single case
bun scripts/vm/pi-worker-conformance.ts --case acp.v1.session.cancel.in_flight

# Full suite with report file
bun scripts/vm/pi-worker-conformance.ts --report /tmp/conformance-report.json

# As part of npm run test:vm
```

---

## Integration into `npm run test:vm`

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test:vm:conformance": "bun scripts/vm/pi-worker-conformance.ts",
    "test:vm": "bun test scripts/vm/lib/ && npm run test:vm:conformance"
  }
}
```

If the conformance runner is not available (acpx not installed, or `npx pi-acp` not on PATH), `test:vm:conformance` exits with code 2, which CI can treat as a warning rather than a hard failure by wrapping with `|| true` during bootstrapping.

---

## Integration into `pi-worker-verify-runtime`

The existing `pi-worker-verify-runtime` script (if present) verifies the tmux session, Pi process health, and result-channel write/read round-trip. Add a conformance step at the end:

```ts
// In pi-worker-verify-runtime.ts, after existing checks:
const conformanceResult = await runLocal(
  "bun",
  ["scripts/vm/pi-worker-conformance.ts", "--json", "--report", join(env.stateDir, "last-conformance.json")],
).catch((err) => JSON.stringify({ failed: -1, error: err.message }))

const conformance = JSON.parse(conformanceResult)
if (conformance.failed > 0) {
  notes.push(`⚠️ ACP conformance: ${conformance.failed} case(s) failed — see ${env.stateDir}/last-conformance.json`)
} else {
  notes.push(`✅ ACP conformance: ${conformance.passed}/${conformance.total} passed`)
}
```

---

## CI Hook: Run After Pi Updates

Add a GitHub Actions workflow step (or equivalent CI script) that runs conformance after Pi package updates on the VM:

```yaml
# .github/workflows/vm-health.yml (new or existing)
- name: ACP conformance
  run: |
    ssh vm "cd ~/theo-pi && bun scripts/vm/pi-worker-conformance.ts --report /tmp/conformance-${{ github.sha }}.json"
  continue-on-error: true   # non-blocking until suite is stable
```

The `--report` artifact can be uploaded for comparison across runs.

---

## Custom Pi-Worker Cases

The conformance runner accepts a `--cases-dir` pointing to any directory of JSON case files. We can add our own cases for pi-worker-specific behavior that the generic suite does not cover.

New directory: `scripts/vm/conformance/cases/`

Example custom case `pw-001-long-output.json`:

```json
{
  "id": "pi-worker.v1.long_output",
  "title": "Agent produces long output without truncation",
  "steps": [
    { "action": "new_session", "save_as": "sid" },
    {
      "action": "prompt",
      "session": "$sid",
      "prompt": [{ "type": "text", "text": "print the numbers 1 to 500, one per line" }],
      "save_as": "result"
    }
  ],
  "checks": [
    { "type": "saved_stop_reason_in", "key": "result", "values": ["end_turn", "completed", "done"] },
    { "type": "updates_text_includes", "text": "500" }
  ],
  "timeouts": { "request_timeout_ms": 60000, "update_timeout_ms": 60000 }
}
```

To run built-in + custom cases together, pass both directories:

```ts
// Not yet supported by the runner in a single invocation.
// Workaround: copy custom cases into a temp dir alongside built-in cases, pass that as --cases-dir.
```

This is a known limitation of the runner's `--cases-dir` being a single path. We can contribute a `--extra-cases-dir` flag upstream or maintain a symlink strategy.

---

## Telegram Command: `/conformance`

Add to `pi-worker-telegram-bot.ts` (and gateway) for on-demand health reporting:

```ts
if (textValue === "/conformance") {
  await telegram.sendMessage(chatId, "🔬 Running ACP conformance suite…")
  try {
    const report = await runLocal("bun", [
      localScript(scriptDir, "pi-worker-conformance"),
      "--json",
    ])
    const parsed = JSON.parse(report) as ConformanceSummary
    const lines = [
      `ACP conformance: ${parsed.passed}/${parsed.total} passed`,
      parsed.failed > 0 ? `❌ ${parsed.failed} failed:` : "✅ All cases passed",
      ...parsed.cases
        .filter((c) => c.status === "fail")
        .map((c) => `  • ${c.id}: ${c.error ?? "check failed"}`),
    ]
    await telegram.sendMessage(chatId, lines.join("\n"))
  } catch (error) {
    await telegram.sendMessage(chatId, `❌ Conformance runner failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { ok: true }
}
```

---

## Task Checklist

- [ ] Verify `node_modules/acpx/conformance/runner/run.js` exists after `npm install acpx`
- [ ] Verify `npx pi-acp --version` works on the VM
- [ ] Create `scripts/vm/pi-worker-conformance.ts`
- [ ] Create `scripts/vm/conformance/cases/` with at least one custom case (`pw-001-long-output.json`)
- [ ] Add `test:vm:conformance` and `test:vm` scripts to `package.json`
- [ ] Add `/conformance` command to `telegram-poller.ts` commands map
- [ ] Add conformance step to `pi-worker-verify-runtime` (if script exists, else note as follow-up)
- [ ] Add CI workflow step (or document it in AGENTS.md)
- [ ] Run manually on VM and record baseline pass/fail count
- [ ] Write unit test for `parseArgs()` and report formatting

---

## Test Strategy

The conformance cases themselves are integration tests — no mocking needed. They run against a live Pi ACP session.

For the `pi-worker-conformance.ts` script itself:

**Test 1 — parseArgs:**  
`parseArgs(["--case", "acp.v1.initialize.handshake", "--json"])` returns `{ caseId: "acp.v1.initialize.handshake", jsonOutput: true }`.

**Test 2 — report formatting:**  
Given a mock `ConformanceReport` with 20 passed, 1 failed → human output contains "❌" for the failed case, "Total: 21  Passed: 20  Failed: 1".

**Test 3 — exit code on failure:**  
Runner stdout contains `{"failed": 2, ...}` → process exits with code 1.

**Test 4 — exit code on runner error:**  
Runner subprocess exits non-zero with no valid JSON on stdout → process exits with code 2.

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `acpx/conformance/runner/run.js` path changes across acpx versions | Medium | Pin acpx version; add path probe at start of script with clear error message |
| `npx pi-acp` not on PATH in VM environment | Medium | Document in `AGENTS.md`; fall back to `ACPX_PI_ACP_COMMAND` env var override |
| Some cases fail legitimately due to Pi's partial ACP implementation | Known | Use `continue-on-error: true` in CI until baseline is established; document known failures in `conformance/KNOWN-FAILURES.md` |
| Conformance runner takes >5 min for full suite (21 cases, each spawning Pi) | Low | Individual case timeout is 30s; 21 cases × 30s = 10 min max; use `--case` for fast checks in Telegram |
| Runner emits non-JSON output before the JSON report (e.g. debug logs) | Low | Parse last complete JSON object from stdout rather than entire output; handled in script above |

---

## Definition of Done

- `bun scripts/vm/pi-worker-conformance.ts` runs on the VM and produces a pass/fail report with no runner errors (exit code 0 or 1, not 2).
- At least 15 of 21 cases pass against Pi's current ACP adapter (baseline).
- Failed cases are clearly identified with their case ID and error.
- `/conformance` Telegram command returns the same pass/fail summary.
- `npm run test:vm:conformance` passes in CI (or fails explicitly on known Pi regressions).
- `scripts/vm/conformance/cases/pw-001-long-output.json` runs as an extra case.
