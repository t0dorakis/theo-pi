#!/usr/bin/env bun
/**
 * Run the acpx ACP conformance suite against Pi's ACP adapter.
 *
 * Usage:
 *   bun scripts/vm/pi-worker-conformance.ts [options]
 *
 * Options:
 *   --case <id>       Run only a specific case ID (repeatable)
 *   --json            Output raw JSON report to stdout
 *   --report <path>   Write JSON report to file
 *   --agent <cmd>     ACP adapter command (default: npx pi-acp)
 *   --core-only       Run only core cases 001-009
 *
 * Exit codes:
 *   0 — all cases passed
 *   1 — one or more cases failed
 *   2 — runner setup error (runner not found, spawn failed, etc.)
 *
 * Case IDs (21 total, acp-core-v1 profile):
 *   Core (001-009):
 *     acp.v1.initialize.handshake
 *     acp.v1.session.new.basic
 *     acp.v1.session.prompt.single_turn
 *     acp.v1.session.update.termination
 *     acp.v1.session.cancel.in_flight
 *     acp.v1.errors.invalid_params
 *     acp.v1.errors.permission_denied
 *     acp.v1.errors.unknown_session
 *     acp.v1.session.cancel.idle
 *   Extended (010-021):
 *     acp.v1.session.prompt.multi_turn
 *     acp.v1.errors.invalid_prompt_session_type
 *     acp.v1.errors.permission_denied.write
 *     acp.v1.session.prompt.echo_empty
 *     acp.v1.session.prompt.unrecognized
 *     acp.v1.errors.invalid_params.cwd_null
 *     acp.v1.session.prompt.structured_blocks
 *     acp.v1.permissions.read.approved
 *     acp.v1.permissions.write.approved
 *     acp.v1.session.prompt.background_completion
 *     acp.v1.session.cancel.followup_prompt
 *     acp.v1.session.prompt.post_success_drain
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

// ─── Case IDs ────────────────────────────────────────────────────────────────

const CORE_CASE_IDS = [
  "acp.v1.initialize.handshake",
  "acp.v1.session.new.basic",
  "acp.v1.session.prompt.single_turn",
  "acp.v1.session.update.termination",
  "acp.v1.session.cancel.in_flight",
  "acp.v1.errors.invalid_params",
  "acp.v1.errors.permission_denied",
  "acp.v1.errors.unknown_session",
  "acp.v1.session.cancel.idle",
]

// ─── Arg parsing ─────────────────────────────────────────────────────────────

type CliOptions = {
  caseIds: string[]
  jsonOutput: boolean
  reportPath: string | undefined
  agentCommand: string
  coreOnly: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    caseIds: [],
    jsonOutput: false,
    reportPath: undefined,
    agentCommand: "npx pi-acp",
    coreOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--case" && argv[i + 1]) {
      opts.caseIds.push(argv[++i])
      continue
    }
    if (token === "--json") {
      opts.jsonOutput = true
      continue
    }
    if (token === "--report" && argv[i + 1]) {
      opts.reportPath = resolve(argv[++i])
      continue
    }
    if (token === "--agent" && argv[i + 1]) {
      opts.agentCommand = argv[++i]
      continue
    }
    if (token === "--core-only") {
      opts.coreOnly = true
      continue
    }
    if (token === "--help" || token === "-h") {
      process.stdout.write(
        `Usage: bun scripts/vm/pi-worker-conformance.ts [options]\n` +
          `\n` +
          `Options:\n` +
          `  --case <id>       Run only a specific case ID (repeatable)\n` +
          `  --json            Output raw JSON report to stdout\n` +
          `  --report <path>   Write JSON report to file\n` +
          `  --agent <cmd>     ACP adapter command (default: npx pi-acp)\n` +
          `  --core-only       Run only core cases 001-009\n`,
      )
      process.exit(0)
    }
    process.stderr.write(`Unknown argument: ${token}\n`)
    process.exit(2)
  }
  return opts
}

// ─── Runner location ──────────────────────────────────────────────────────────

type RunnerPaths = {
  runnerScript: string
  profilePath: string
  casesDir: string
  /** "bun" for .ts, "node" for .js */
  executor: "bun" | "node"
}

function findRunnerPaths(): RunnerPaths | null {
  const scriptDir = new URL(".", import.meta.url).pathname
  const projectRoot = resolve(scriptDir, "..", "..")

  const candidates: string[] = []

  // 1. Local node_modules (installed via npm install acpx)
  candidates.push(join(projectRoot, "node_modules", "acpx"))

  // 2. Global via require.resolve (may throw if not found)
  try {
    const acpxMain = require.resolve("acpx", { paths: [projectRoot] })
    candidates.push(dirname(dirname(acpxMain))) // up from dist/cli.js to package root
  } catch {
    // not resolvable
  }

  // 3. Global system paths
  for (const globalRoot of [
    "/usr/lib/node_modules/acpx",
    "/usr/local/lib/node_modules/acpx",
  ]) {
    candidates.push(globalRoot)
  }

  // 4. npm root -g fallback
  try {
    const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()
    candidates.push(join(npmRoot, "acpx"))
  } catch {
    // npm not available or failed
  }

  for (const acpxRoot of candidates) {
    // Prefer TypeScript source (run with bun) — works when source tree is accessible
    const tsRunner = join(acpxRoot, "conformance", "runner", "run.ts")
    const jsRunner = join(acpxRoot, "conformance", "runner", "run.js")
    const profilePath = join(acpxRoot, "conformance", "profiles", "acp-core-v1.json")
    const casesDir = join(acpxRoot, "conformance", "cases")

    if (existsSync(tsRunner) && existsSync(profilePath) && existsSync(casesDir)) {
      return { runnerScript: tsRunner, profilePath, casesDir, executor: "bun" }
    }
    if (existsSync(jsRunner) && existsSync(profilePath) && existsSync(casesDir)) {
      return { runnerScript: jsRunner, profilePath, casesDir, executor: "node" }
    }
  }

  return null
}

// ─── Report types (mirror acpx RunReport) ────────────────────────────────────

type CaseResult = {
  id: string
  title: string
  passed: boolean
  durationMs: number
  error?: string
}

type RunReport = {
  profileId: string
  startedAt: string
  completedAt: string
  agentCommand: string
  cwd: string
  permissionMode: string
  totals: {
    cases: number
    passed: number
    failed: number
  }
  results: CaseResult[]
}

// ─── Human-readable summary ───────────────────────────────────────────────────

function printSummary(report: RunReport): void {
  const width = 72
  const { totals } = report
  process.stdout.write(`\nACP Conformance Profile: ${report.profileId}\n`)
  process.stdout.write(`${"─".repeat(width)}\n`)
  for (const c of report.results) {
    const icon = c.passed ? "PASS" : "FAIL"
    const duration = `${c.durationMs}ms`.padStart(8)
    process.stdout.write(`[${icon}] ${c.id.padEnd(56)} ${duration}\n`)
    if (!c.passed && c.error) {
      process.stdout.write(`       └─ ${c.error}\n`)
    }
  }
  process.stdout.write(`${"─".repeat(width)}\n`)
  process.stdout.write(
    `Total: ${totals.cases}  Passed: ${totals.passed}  Failed: ${totals.failed}\n`,
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2))

const runnerPaths = findRunnerPaths()
if (!runnerPaths) {
  process.stderr.write(
    "acpx conformance runner not found. Run: npm install acpx\n" +
      "(Checked: node_modules/acpx, global npm root, /usr/lib/node_modules/acpx)\n",
  )
  process.exit(1)
}

const { runnerScript, profilePath, casesDir, executor } = runnerPaths

// Build runner args
const runnerArgs: string[] = [
  runnerScript,
  "--profile",
  profilePath,
  "--cases-dir",
  casesDir,
  "--agent-command",
  opts.agentCommand,
  "--permission-mode",
  "approve-all",
  "--format",
  "json",
]

// --core-only: add --case for each core case
const effectiveCaseIds = opts.coreOnly ? CORE_CASE_IDS : opts.caseIds
for (const id of effectiveCaseIds) {
  runnerArgs.push("--case", id)
}

if (opts.reportPath) {
  runnerArgs.push("--report", opts.reportPath)
}

// Spawn runner and capture output
const { spawnSync } = await import("node:child_process")

const result = spawnSync(executor, runnerArgs, {
  env: process.env,
  maxBuffer: 1024 * 1024 * 8,
  timeout: 10 * 60 * 1000, // 10 min max for full suite
  encoding: "buffer",
})

if (result.error) {
  process.stderr.write(`conformance runner failed to spawn: ${result.error.message}\n`)
  process.exit(2)
}

const stdout = result.stdout?.toString("utf8") ?? ""
const stderr = result.stderr?.toString("utf8") ?? ""

if (stderr.trim()) {
  process.stderr.write(stderr)
}

// The runner exits 1 on test failures and writes JSON to stdout.
// Exit code 2 from runner means setup/parse error (not a test failure).
if (result.status === 2 || (result.status !== 0 && result.status !== 1)) {
  if (stdout.trim()) process.stderr.write(stdout)
  process.stderr.write(`conformance runner exited with status ${String(result.status)}\n`)
  process.exit(2)
}

// Parse JSON report from stdout (last complete JSON object, in case there's debug output)
let report: RunReport
try {
  // Try to extract the last JSON object from stdout
  const lastBrace = stdout.lastIndexOf("}")
  const firstBrace = stdout.indexOf("{")
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("no JSON object in runner output")
  }
  report = JSON.parse(stdout.slice(firstBrace, lastBrace + 1)) as RunReport
} catch (err) {
  process.stderr.write(
    `conformance runner produced invalid JSON output: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  if (stdout.trim()) process.stderr.write(`runner stdout:\n${stdout}\n`)
  process.exit(2)
}

if (opts.reportPath) {
  // Runner already wrote report if --report was passed; note the path.
  process.stdout.write(`report written to ${opts.reportPath}\n`)
}

if (opts.jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  printSummary(report)
}

process.exit(report.totals.failed > 0 ? 1 : 0)
