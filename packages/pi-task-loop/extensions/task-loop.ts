import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type TaskStatus = "pending" | "in_progress" | "done" | "blocked";

type LoopTask = {
  id: string;
  title: string;
  status: TaskStatus;
  notes?: string;
  updatedAt?: string;
};

type TaskArchiveEntry = {
  concludedAt: string;
  reason: string;
  tasks: LoopTask[];
};

type LoopState = {
  version: 1;
  active: boolean;
  iteration: number;
  intervalSeconds: number;
  lastTickAt?: string;
  nextTickAt?: string;
  lastPrompt?: string;
  lastStopReason?: string | null;
};

type TaskToolAction = "list" | "upsert" | "set_status" | "remove" | "conclude" | "replace_all";

type TaskToolParams = {
  action?: string;
  id?: string;
  taskId?: string;
  task_id?: string;
  title?: string;
  name?: string;
  status?: string;
  notes?: string;
  reason?: string;
  task?: Partial<LoopTask>;
  tasks?: Array<Partial<LoopTask>>;
};

const STATUS_KEY = "task-loop";
const DEFAULT_INTERVAL_SECONDS = 15 * 60;
const MIN_INTERVAL_SECONDS = 15;
const TICK_MARKER = "[task-loop tick]";

function statePath(ctx: ExtensionContext) {
  return path.join(ctx.cwd, ".agent", "loop-state.json");
}

function contextPath(ctx: ExtensionContext) {
  return path.join(ctx.cwd, ".agent", "loop-context.md");
}

function tasksPath(ctx: ExtensionContext) {
  return path.join(ctx.cwd, ".agent", "tasks.json");
}

function tasksHistoryPath(ctx: ExtensionContext) {
  return path.join(ctx.cwd, ".agent", "tasks-history.json");
}

function progressPath(ctx: ExtensionContext) {
  return path.join(ctx.cwd, ".agent", "progress.md");
}

function ensureAgentDir(ctx: ExtensionContext) {
  fs.mkdirSync(path.join(ctx.cwd, ".agent"), { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function defaultState(): LoopState {
  return {
    version: 1,
    active: false,
    iteration: 0,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    lastStopReason: null,
  };
}

function readState(ctx: ExtensionContext): LoopState {
  try {
    const raw = fs.readFileSync(statePath(ctx), "utf8");
    const parsed = JSON.parse(raw) as Partial<LoopState>;
    return {
      version: 1,
      active: parsed.active ?? false,
      iteration: parsed.iteration ?? 0,
      intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, parsed.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS),
      lastTickAt: parsed.lastTickAt,
      nextTickAt: parsed.nextTickAt,
      lastPrompt: parsed.lastPrompt,
      lastStopReason: parsed.lastStopReason ?? null,
    };
  } catch {
    return defaultState();
  }
}

function writeState(ctx: ExtensionContext, state: LoopState) {
  ensureAgentDir(ctx);
  fs.writeFileSync(statePath(ctx), JSON.stringify(state, null, 2));
}

function readLoopContext(ctx: ExtensionContext) {
  try {
    return fs.readFileSync(contextPath(ctx), "utf8").trim();
  } catch {
    return "";
  }
}

function writeLoopContext(ctx: ExtensionContext, text: string) {
  ensureAgentDir(ctx);
  fs.writeFileSync(contextPath(ctx), `${text.trim()}\n`);
}

function parseDurationSeconds(input: string) {
  const value = input.trim();
  const match = value.match(/^(\d+)(s|m|h)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const factor = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return Math.max(MIN_INTERVAL_SECONDS, amount * factor);
}

function formatInterval(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function normalizeTask(raw: Partial<LoopTask>, fallbackIndex: number): LoopTask {
  return {
    id: String(raw.id ?? `task-${fallbackIndex + 1}`),
    title: String(raw.title ?? `Task ${fallbackIndex + 1}`),
    status: raw.status === "in_progress" || raw.status === "done" || raw.status === "blocked" ? raw.status : "pending",
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

function readTasks(ctx: ExtensionContext): LoopTask[] {
  try {
    const raw = fs.readFileSync(tasksPath(ctx), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((task, index) => normalizeTask(task as Partial<LoopTask>, index)) : [];
  } catch {
    return [];
  }
}

function writeTasks(ctx: ExtensionContext, tasks: LoopTask[]) {
  ensureAgentDir(ctx);
  fs.writeFileSync(tasksPath(ctx), JSON.stringify(tasks, null, 2));
}

function readTaskHistory(ctx: ExtensionContext): TaskArchiveEntry[] {
  try {
    const raw = fs.readFileSync(tasksHistoryPath(ctx), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as TaskArchiveEntry[] : [];
  } catch {
    return [];
  }
}

function writeTaskHistory(ctx: ExtensionContext, history: TaskArchiveEntry[]) {
  ensureAgentDir(ctx);
  fs.writeFileSync(tasksHistoryPath(ctx), JSON.stringify(history, null, 2));
}

function getActiveTasks(ctx: ExtensionContext) {
  return readTasks(ctx).filter((task) => task.status !== "done");
}

function countTasks(ctx: ExtensionContext) {
  return readTasks(ctx).length;
}

function loopShouldStop(ctx: ExtensionContext): string | null {
  const tasks = readTasks(ctx);
  if (tasks.length === 0) return "no active tasks";
  const activeTasks = tasks.filter((task) => task.status !== "done");
  if (activeTasks.length === 0) return "no active tasks";
  return null;
}

function buildTickPrompt(ctx: ExtensionContext, state: LoopState) {
  const extraContext = readLoopContext(ctx);
  const activeTasks = getActiveTasks(ctx);
  const preview = activeTasks.slice(0, 5).map((task) => `- ${task.id} [${task.status}] ${task.title}`).join("\n");
  const parts = [
    `${TICK_MARKER} iteration ${state.iteration + 1}`,
    "Autonomous continuation tick.",
    "Resume established work only.",
    "Read `.agent/progress.md` first.",
    "Use the task-loop task tool as source of truth for task state instead of hand-editing `.agent/tasks.json`.",
    "Choose highest-value active task already implied by repo state and prior instructions.",
    "Complete at most ONE task in this tick.",
    "After that one task is done, update `.agent/progress.md`, record task state with the task tool, run focused verification if feasible, then stop.",
    "Do not batch multiple tasks into one tick unless they are inseparable parts of the same atomic fix.",
    "Continue without asking unless blocked by irreversible action, external side effect, missing credentials, or a real product/business choice.",
    "Keep commentary minimal.",
  ];
  if (preview) parts.push("", "Current active tasks:", preview);
  if (extraContext) parts.push("", "Operator context:", extraContext);
  if (!fs.existsSync(progressPath(ctx))) {
    parts.push("", "If `.agent/progress.md` is missing, infer best continuation from current repo state and create/update it only if clearly appropriate.");
  }
  return parts.join("\n");
}

function isTickPrompt(prompt: unknown) {
  if (typeof prompt === "string") return prompt.includes(TICK_MARKER);
  if (Array.isArray(prompt)) {
    return prompt.some((part) => part && typeof part === "object" && "type" in part && (part as { type?: string; text?: string }).type === "text" && ((part as { text?: string }).text ?? "").includes(TICK_MARKER));
  }
  return false;
}

function upsertTask(tasks: LoopTask[], task: LoopTask) {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index === -1) return [...tasks, task];
  return tasks.map((item, itemIndex) => itemIndex === index ? task : item);
}

function normalizeStatus(status: unknown): TaskStatus | undefined {
  if (typeof status !== "string") return undefined;
  const value = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["pending", "todo", "open"].includes(value)) return "pending";
  if (["in_progress", "inprogress", "active", "working", "started"].includes(value)) return "in_progress";
  if (["done", "completed", "complete", "finished", "closed"].includes(value)) return "done";
  if (["blocked", "stuck", "waiting"].includes(value)) return "blocked";
  return undefined;
}

function normalizeAction(params: TaskToolParams): TaskToolAction {
  const raw = typeof params.action === "string" ? params.action.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (["", "list", "get", "show", "read", "status"].includes(raw)) {
    if (params.tasks) return "replace_all";
    if (params.reason && !params.id && !params.taskId && !params.task_id && !params.task && !params.title && !params.name && !params.status) return "conclude";
    if (params.task || params.title || params.name) return "upsert";
    if ((params.id || params.taskId || params.task_id) && params.status) return "set_status";
    return "list";
  }
  if (["upsert", "add", "create", "put", "insert"].includes(raw)) return "upsert";
  if (["set_status", "setstatus", "update", "update_status", "complete", "start", "block", "done"].includes(raw)) return "set_status";
  if (["remove", "delete", "drop"].includes(raw)) return "remove";
  if (["conclude", "finish", "archive", "clear", "complete_all"].includes(raw)) return "conclude";
  if (["replace_all", "replace", "set_all", "overwrite"].includes(raw)) return "replace_all";
  throw new Error(`unknown action: ${params.action}`);
}

function normalizeTaskToolParams(params: TaskToolParams) {
  const rawAction = typeof params.action === "string" ? params.action.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const action = normalizeAction(params);
  const task = params.task ?? {};
  const id = params.id ?? params.taskId ?? params.task_id ?? task.id;
  const title = params.title ?? params.name ?? task.title;
  const notes = params.notes ?? task.notes;
  const inferredStatus = rawAction === "complete" || rawAction === "done"
    ? "done"
    : rawAction === "start"
      ? "in_progress"
      : rawAction === "block"
        ? "blocked"
        : undefined;
  const status = normalizeStatus(params.status ?? task.status ?? inferredStatus);
  const tasks = (params.tasks ?? []).map((item, index) => normalizeTask({
    id: item.id,
    title: item.title,
    status: normalizeStatus(item.status) ?? item.status,
    notes: item.notes,
  }, index));
  return {
    action,
    id,
    title,
    status,
    notes,
    reason: params.reason,
    tasks,
  };
}

export default function taskLoop(pi: ExtensionAPI) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function updateStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const state = readState(ctx);
    const activeCount = getActiveTasks(ctx).length;
    const text = state.active
      ? `loop:on i${state.iteration} ${formatInterval(state.intervalSeconds)} t${activeCount}`
      : `loop:off${state.lastStopReason ? ` ${state.lastStopReason}` : ""}`;
    ctx.ui.setStatus(STATUS_KEY, text);
  }

  function stopLoop(ctx: ExtensionContext, reason: string, notify = false) {
    clearTimer();
    const state = readState(ctx);
    state.active = false;
    state.nextTickAt = undefined;
    state.lastStopReason = reason;
    writeState(ctx, state);
    updateStatus(ctx);
    if (notify && ctx.hasUI) ctx.ui.notify(`Task loop stopped: ${reason}`, "info");
  }

  function queueTick(ctx: ExtensionContext, immediate = false) {
    clearTimer();
    const state = readState(ctx);
    if (!state.active && !immediate) {
      updateStatus(ctx);
      return;
    }

    const stopReason = loopShouldStop(ctx);
    if (stopReason) {
      stopLoop(ctx, stopReason, true);
      return;
    }

    const delayMs = immediate ? 0 : state.intervalSeconds * 1000;
    const nextTickAt = new Date(Date.now() + delayMs).toISOString();
    if (state.active) {
      state.nextTickAt = nextTickAt;
      writeState(ctx, state);
    }
    updateStatus(ctx);

    timer = setTimeout(() => {
      const freshState = readState(ctx);
      const freshStopReason = loopShouldStop(ctx);
      if (freshStopReason) {
        stopLoop(ctx, freshStopReason, true);
        return;
      }
      const prompt = buildTickPrompt(ctx, freshState);
      freshState.iteration += 1;
      freshState.lastTickAt = nowIso();
      freshState.lastPrompt = prompt;
      freshState.nextTickAt = undefined;
      if (freshState.active) writeState(ctx, freshState);
      updateStatus(ctx);
      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      }
    }, delayMs);
  }

  pi.registerTool({
    name: "task_loop_tasks",
    label: "Task Loop Tasks",
    description: "Manage canonical task-loop task state in .agent/tasks.json and .agent/tasks-history.json.",
    promptSnippet: "Read and update canonical active task state for the task loop.",
    promptGuidelines: [
      "Use task_loop_tasks instead of hand-editing .agent/tasks.json.",
      "Keep active tasks in .agent/tasks.json. When work batch truly concludes, use conclude to archive and clear the active list.",
      "Prefer updating exactly one task per loop tick unless a new task must be created to reflect discovered work.",
    ],
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "Action. Also accepts aliases like add, update, complete, finish, replace, show." })),
      id: Type.Optional(Type.String()),
      taskId: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      status: Type.Optional(Type.String({ description: "Status. Also accepts in-progress, completed, active, todo." })),
      notes: Type.Optional(Type.String()),
      task: Type.Optional(Type.Object({
        id: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        status: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
      })),
      tasks: Type.Optional(Type.Array(Type.Object({
        id: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        status: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
      }))),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const tasks = readTasks(ctx);
      const normalized = normalizeTaskToolParams(params as TaskToolParams);
      const action = normalized.action;
      let nextTasks = tasks;
      let history = readTaskHistory(ctx);
      let message = "";

      if (action === "list") {
        message = `Active tasks: ${tasks.length}`;
      } else if (action === "replace_all") {
        nextTasks = normalized.tasks.map((task) => ({ ...task, updatedAt: nowIso() }));
        writeTasks(ctx, nextTasks);
        message = `Replaced active task list (${nextTasks.length} tasks)`;
      } else if (action === "upsert") {
        if (!normalized.id || !normalized.title) throw new Error("upsert requires id and title");
        const task: LoopTask = {
          id: normalized.id,
          title: normalized.title,
          status: normalized.status ?? "pending",
          notes: normalized.notes,
          updatedAt: nowIso(),
        };
        nextTasks = upsertTask(tasks, task);
        writeTasks(ctx, nextTasks);
        message = `Upserted task ${task.id}`;
      } else if (action === "set_status") {
        if (!normalized.id || !normalized.status) throw new Error("set_status requires id and status");
        nextTasks = tasks.map((task) => task.id === normalized.id ? { ...task, status: normalized.status, notes: normalized.notes ?? task.notes, updatedAt: nowIso() } : task);
        writeTasks(ctx, nextTasks);
        message = `Updated task ${normalized.id} -> ${normalized.status}`;
      } else if (action === "remove") {
        if (!normalized.id) throw new Error("remove requires id");
        nextTasks = tasks.filter((task) => task.id !== normalized.id);
        writeTasks(ctx, nextTasks);
        message = `Removed task ${normalized.id}`;
      } else if (action === "conclude") {
        const reason = normalized.reason ?? "completed";
        if (tasks.length > 0) {
          history = [...history, { concludedAt: nowIso(), reason, tasks }];
          writeTaskHistory(ctx, history);
        }
        writeTasks(ctx, []);
        nextTasks = [];
        message = `Concluded active task list: ${reason}`;
      }

      updateStatus(ctx);
      return {
        content: [{ type: "text", text: message || "OK" }],
        details: {
          action,
          tasks: nextTasks,
          activeCount: nextTasks.filter((task) => task.status !== "done").length,
          historyCount: history.length,
        },
      };
    },
  });

  pi.registerCommand("task-loop", {
    description: "Manage autonomous continuation loop",
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const value = rest.join(" ").trim();
      const state = readState(ctx);
      const cmd = subcommand ?? "status";

      if (cmd === "on") {
        state.active = true;
        state.lastStopReason = null;
        writeState(ctx, state);
        updateStatus(ctx);
        queueTick(ctx, true);
        if (ctx.hasUI) ctx.ui.notify(`Task loop on (${formatInterval(state.intervalSeconds)})`, "info");
        return;
      }

      if (cmd === "off") {
        stopLoop(ctx, "manual", true);
        return;
      }

      if (cmd === "once") {
        queueTick(ctx, true);
        if (ctx.hasUI) ctx.ui.notify("Queued one autonomous continuation tick", "info");
        return;
      }

      if (cmd === "interval") {
        const seconds = parseDurationSeconds(value);
        if (!seconds) {
          if (ctx.hasUI) ctx.ui.notify("Usage: /task-loop interval <15s|5m|1h>", "warning");
          return;
        }
        state.intervalSeconds = seconds;
        writeState(ctx, state);
        updateStatus(ctx);
        if (state.active) queueTick(ctx, false);
        if (ctx.hasUI) ctx.ui.notify(`Task loop interval set to ${formatInterval(seconds)}`, "info");
        return;
      }

      if (cmd === "context") {
        if (!value) {
          const current = readLoopContext(ctx);
          if (ctx.hasUI) ctx.ui.notify(current || "No task loop context set", "info");
          return;
        }
        writeLoopContext(ctx, value);
        if (ctx.hasUI) ctx.ui.notify("Task loop context updated", "info");
        return;
      }

      const tasks = readTasks(ctx);
      const activeCount = tasks.filter((task) => task.status !== "done").length;
      const next = state.nextTickAt ? new Date(state.nextTickAt).toLocaleString() : "none";
      const summary = [
        `active: ${state.active}`,
        `iteration: ${state.iteration}`,
        `interval: ${formatInterval(state.intervalSeconds)}`,
        `next tick: ${next}`,
        `tasks: ${tasks.length}`,
        `active tasks: ${activeCount}`,
        `last stop: ${state.lastStopReason ?? "none"}`,
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(summary, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
    const state = readState(ctx);
    if (state.active) queueTick(ctx, false);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!isTickPrompt(event.prompt)) return;
    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## Task Loop Turn\n\nThis turn was scheduled by the task-loop extension. Resume established work already implied by repo state. Do not invent unrelated work. Use task_loop_tasks as the source of truth for task state instead of hand-editing .agent/tasks.json. Complete at most one task this turn, unless multiple tiny edits are inseparable parts of that one task. Update .agent/progress.md before stopping. Keep commentary minimal. Ask only for irreversible action, external side effects, missing credentials, or real product decisions. When the full active batch is truly complete, conclude it so the active task list becomes empty.",
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const state = readState(ctx);
    if (!state.active) {
      updateStatus(ctx);
      return;
    }
    const stopReason = loopShouldStop(ctx);
    if (stopReason) {
      stopLoop(ctx, stopReason, true);
      return;
    }
    queueTick(ctx, false);
  });

  pi.on("session_shutdown", async () => {
    clearTimer();
  });
}
