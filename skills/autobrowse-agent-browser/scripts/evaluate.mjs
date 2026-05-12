#!/usr/bin/env node

/**
 * evaluate.mjs — ACPX-backed inner agent harness.
 *
 * Runs a browser-learning task through ACPX instead of direct model API keys.
 * The delegated agent uses agent-browser commands, then returns a concise JSON
 * result plus learnings. This harness stores prompt/output artifacts per run.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_ACPX_PACKAGE = "acpx@0.7.0";
const DEFAULT_AGENT = "claude";

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function showHelp() {
  console.log(`evaluate.mjs — ACPX-backed inner agent harness for autobrowse-agent-browser

Usage: node scripts/evaluate.mjs --task <name> [options]

Options:
  --task <name>        Task name — matches tasks/<name>/ directory (required)
  --workspace <dir>    Workspace root holding tasks/ and traces/ (default: ./autobrowse)
  --run-number N       Force a specific run number (default: auto-increment)
  --agent <name>       ACPX agent command/name (default: ${DEFAULT_AGENT})
  --timeout <seconds>  ACPX timeout (default: ${DEFAULT_TIMEOUT_SECONDS})
  --deny-all           Pass --deny-all to acpx instead of --approve-all
  --help               Show this help message

Environment variables:
  ACPX_PACKAGE         ACPX npm package spec (default: ${DEFAULT_ACPX_PACKAGE})
  ACPX_AGENT           Default ACPX agent command/name

Output:
  traces/<task>/run-NNN/summary.md     Run summary and final output
  traces/<task>/run-NNN/prompt.md      Prompt sent to ACPX
  traces/<task>/run-NNN/output.txt     Raw ACPX quiet output
  traces/<task>/run-NNN/screenshots/   Suggested screenshot directory

Examples:
  node scripts/evaluate.mjs --task google-flights
  node scripts/evaluate.mjs --task checkout --agent claude --timeout 1200`);
  process.exit(0);
}

function resolveWorkspace() {
  return path.resolve(getArg("workspace", "autobrowse"));
}

function getTaskName(workspace) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) showHelp();

  const task = getArg("task");
  if (!task) {
    console.error("ERROR: --task <name> is required");
    console.error("\nAvailable tasks:");
    const tasksDir = path.join(workspace, "tasks");
    if (fs.existsSync(tasksDir)) {
      const dirs = fs.readdirSync(tasksDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `  - ${d.name}`);
      console.error(dirs.length ? dirs.join("\n") : "  (none — create tasks/<name>/task.md)");
    } else {
      console.error("  (no tasks/ directory found)");
    }
    process.exit(1);
  }
  return task;
}

function getNextRunNumber(tracesDir) {
  const forced = getArg("run-number");
  if (forced) {
    const n = Number.parseInt(forced, 10);
    if (Number.isNaN(n)) throw new Error(`invalid --run-number: ${forced}`);
    return n;
  }
  if (!fs.existsSync(tracesDir)) return 1;
  const nums = fs.readdirSync(tracesDir)
    .filter((d) => d.startsWith("run-"))
    .map((d) => Number.parseInt(d.replace("run-", ""), 10))
    .filter((n) => !Number.isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function claimRunDir(tracesDir) {
  fs.mkdirSync(tracesDir, { recursive: true });
  const forced = getArg("run-number");
  for (let attempt = 0; attempt < 100; attempt++) {
    const runNumber = forced ? getNextRunNumber(tracesDir) : getNextRunNumber(tracesDir) + attempt;
    const runId = `run-${String(runNumber).padStart(3, "0")}`;
    const traceDir = path.join(tracesDir, runId);
    try {
      fs.mkdirSync(traceDir, { recursive: false });
      fs.mkdirSync(path.join(traceDir, "screenshots"), { recursive: false });
      return { runNumber, runId, traceDir };
    } catch (err) {
      if (err?.code === "EEXIST" && !forced) continue;
      throw err;
    }
  }
  throw new Error(`failed to claim run directory under ${tracesDir}`);
}

function buildPrompt({ taskName, task, strategy, traceDir, sessionName }) {
  return `You are running autobrowse-agent-browser for task \`${taskName}\`.

Goal: complete the browser task using \`agent-browser\`, then report whether strategy worked and what should change next.

You are allowed to browse the web with \`agent-browser\` and write local files under the workspace/trace directory for screenshots, notes, extracted data, or helper artifacts. Do not use Browserbase \`browse\` commands. Use \`agent-browser\` commands and refs like \`@e1\`.

Use this isolated browser session for every command so parallel test runs do not collide: \`agent-browser --session ${sessionName} ...\`.

Required workflow:
1. Open the target URL or best public search URL with \`agent-browser --session ${sessionName} open <url>\`.
2. Use \`agent-browser --session ${sessionName} wait --load networkidle\` after navigation when useful.
3. Use \`agent-browser --session ${sessionName} snapshot -i\` after navigation and after each DOM-changing action.
4. Use current \`@eN\` refs only; never invent refs.
5. Prefer \`agent-browser --session ${sessionName} fill @eN "value"\` for fields and \`agent-browser --session ${sessionName} keyboard type "text"\` only for focused-field typing.
6. Use \`agent-browser --session ${sessionName} get text body\` or \`agent-browser --session ${sessionName} eval 'document.body.innerText'\` for extraction.
7. Save screenshots for important failures or decisions under: ${traceDir}/screenshots/
8. If \`agent-browser\` is missing, use \`npx agent-browser ...\` or install it with \`npm install -g agent-browser\` if permitted; keep the same \`--session ${sessionName}\` flag.
9. Return final answer as a JSON code block matching task.md as closely as possible.

Current learned strategy:

${strategy}

Task definition:

${task}

At end, include:
- final JSON output
- pass/fail
- commands or key observations
- one concrete suggested patch for strategy.md, if any
`;
}

function runAcpx({ prompt, cwd, timeoutSeconds, agent, approveMode }) {
  const acpxPackage = process.env.ACPX_PACKAGE || DEFAULT_ACPX_PACKAGE;
  const args = [
    "--yes",
    acpxPackage,
    "--cwd",
    cwd,
    "--format",
    "quiet",
    "--timeout",
    String(timeoutSeconds),
    approveMode,
    agent,
    "exec",
    prompt,
  ];
  return execFileSync("npx", args, {
    cwd,
    encoding: "utf8",
    timeout: (timeoutSeconds + 60) * 1000,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function updateLatestSymlink(tracesDir, runId) {
  const latestLink = path.join(tracesDir, "latest");
  try {
    const stat = fs.lstatSync(latestLink, { throwIfNoEntry: false });
    if (stat) fs.unlinkSync(latestLink);
    fs.symlinkSync(runId, latestLink);
  } catch (err) {
    console.warn(`Warning: failed to update latest symlink: ${err.message}`);
  }
}

function main() {
  const workspace = resolveWorkspace();
  const taskName = getTaskName(workspace);
  const taskDir = path.join(workspace, "tasks", taskName);
  const tracesDir = path.join(workspace, "traces", taskName);
  const taskFile = path.join(taskDir, "task.md");
  const strategyFile = path.join(taskDir, "strategy.md");

  if (!fs.existsSync(taskFile)) {
    console.error(`ERROR: ${path.relative(process.cwd(), taskFile)} not found.`);
    console.error(`Create it from template: ${path.join(SKILL_DIR, "references/example-task.md")}`);
    process.exit(1);
  }
  if (!fs.existsSync(strategyFile)) {
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(strategyFile, `# ${taskName} Navigation Skill\n\n(This grows as the agent learns through iterations)\n`);
    console.error(`Created empty strategy.md for task "${taskName}"`);
  }

  const { runNumber, runId, traceDir } = claimRunDir(tracesDir);

  const task = fs.readFileSync(taskFile, "utf8");
  const strategy = fs.readFileSync(strategyFile, "utf8");
  const sessionName = `autobrowse-${taskName}-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const prompt = buildPrompt({ taskName, task, strategy, traceDir, sessionName });
  fs.writeFileSync(path.join(traceDir, "prompt.md"), prompt);

  const timeoutSeconds = Number.parseInt(getArg("timeout", String(DEFAULT_TIMEOUT_SECONDS)), 10);
  const agent = getArg("agent", process.env.ACPX_AGENT || DEFAULT_AGENT);
  const approveMode = hasFlag("deny-all") ? "--deny-all" : "--approve-all";
  const start = Date.now();

  console.error(`\n${"=".repeat(60)}`);
  console.error(`  AUTOBROWSE AGENT-BROWSER — ${taskName} — ${runId}`);
  console.error(`${"=".repeat(60)}`);
  console.error(`ACPX agent: ${agent} | Timeout: ${timeoutSeconds}s | Permissions: ${approveMode}`);
  console.error(`Trace: ${traceDir}\n`);

  let output = "";
  let status = "completed";
  let errorText = "";
  try {
    output = runAcpx({ prompt, cwd: process.cwd(), timeoutSeconds, agent, approveMode });
  } catch (err) {
    status = "failed";
    const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8") || "";
    const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8") || "";
    output = stdout;
    errorText = stderr || err.message || String(err);
  }

  fs.writeFileSync(path.join(traceDir, "output.txt"), output);
  if (errorText) fs.writeFileSync(path.join(traceDir, "error.txt"), errorText);

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  const summary = [
    `# ${taskName} — ${runId} Summary`,
    "",
    `**Status:** ${status}`,
    `**Duration:** ${durationSec}s`,
    `**ACPX agent:** ${agent}`,
    `**Permissions:** ${approveMode}`,
    "",
    "## ACPX Output",
    "",
    output || "(no stdout)",
    errorText ? `\n## Error\n\n\`\`\`\n${errorText}\n\`\`\`` : "",
  ].filter(Boolean).join("\n");

  fs.writeFileSync(path.join(traceDir, "summary.md"), summary);
  updateLatestSymlink(tracesDir, runId);

  console.error(`\nWrote ${path.join(traceDir, "summary.md")}`);
  if (status === "failed") {
    console.error(errorText.slice(0, 1000));
    process.exit(1);
  }
  console.log(output.trim());
}

main();
