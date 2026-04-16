import fs from 'node:fs';
import path from 'node:path';

const piPkg = await import('file:///Users/minimi/.local/share/fnm/node-versions/v24.14.0/installation/lib/node_modules/@mariozechner/pi-coding-agent/dist/index.js');
const { DefaultResourceLoader, SessionManager, createAgentSession } = piPkg;

const root = path.resolve(process.cwd());
const fixtureDir = path.join(root, 'dogfood', 'task-loop-e2e');
const extensionPath = path.join(root, 'packages', 'pi-task-loop', 'extensions', 'task-loop.ts');
const timeoutMs = 12 * 60 * 1000;
const pollMs = 5_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const loopStateFile = path.join(fixtureDir, '.agent', 'loop-state.json');
const tasksFile = path.join(fixtureDir, '.agent', 'tasks.json');

const resourceLoader = new DefaultResourceLoader({
  additionalExtensionPaths: [extensionPath],
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  cwd: fixtureDir,
  resourceLoader,
  sessionManager: SessionManager.inMemory(),
});

let assistantBuffer = '';
let agentRuns = 0;
let lastActivity = Date.now();

session.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    process.stdout.write(event.assistantMessageEvent.delta);
    assistantBuffer += event.assistantMessageEvent.delta;
    lastActivity = Date.now();
  }
  if (event.type === 'tool_execution_start') {
    process.stdout.write(`\n[tool:start] ${event.toolName}\n`);
    lastActivity = Date.now();
  }
  if (event.type === 'tool_execution_end') {
    process.stdout.write(`\n[tool:end] ${event.toolName}${event.isError ? ' ERROR' : ''}\n`);
    lastActivity = Date.now();
  }
  if (event.type === 'agent_end') {
    agentRuns += 1;
    process.stdout.write(`\n[agent:end] runs=${agentRuns}\n`);
    lastActivity = Date.now();
  }
  if (event.type === 'queue_update') {
    process.stdout.write(`\n[queue] steer=${event.steering.length} followUp=${event.followUp.length}\n`);
  }
});

console.log(`Fixture: ${fixtureDir}`);
console.log(`Extension: ${extensionPath}`);

await session.prompt('/task-loop context Dogfood the task-loop extension in this repo. Work only inside this fixture repo. Complete all 10 tasks in .agent/tasks.json. Keep .agent/progress.md and .agent/tasks.json accurate as work progresses. Run npm test before claiming completion. Continue autonomously until all tasks are truly done or a real blocker exists.');
await session.prompt('/task-loop interval 15s');
await session.prompt('/task-loop on');

const startedAt = Date.now();
let success = false;
let terminalReason = 'timeout';

while (Date.now() - startedAt < timeoutMs) {
  const state = readJson(loopStateFile);
  const tasks = readJson(tasksFile) ?? [];
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const active = !!state?.active;
  const stopReason = state?.lastStopReason ?? null;

  console.log(`\n[poll] active=${active} iteration=${state?.iteration ?? 0} activeTasks=${activeTasks.length} stop=${stopReason ?? 'none'} idleFor=${Math.round((Date.now()-lastActivity)/1000)}s`);

  if (!active && activeTasks.length === 0) {
    success = true;
    terminalReason = stopReason ?? 'done';
    break;
  }

  if (!active && activeTasks.length > 0) {
    terminalReason = `stopped early: ${stopReason ?? 'unknown'}`;
    break;
  }

  await sleep(pollMs);
}

console.log('\n===== FINAL TASKS =====');
console.log(readText(tasksFile));
console.log('\n===== FINAL PROGRESS =====');
console.log(readText(path.join(fixtureDir, '.agent', 'progress.md')));
console.log('\n===== FINAL LOOP STATE =====');
console.log(readText(loopStateFile));

if (!success) {
  console.error(`\nE2E failed: ${terminalReason}`);
  process.exit(1);
}

console.log(`\nE2E passed: ${terminalReason}`);
