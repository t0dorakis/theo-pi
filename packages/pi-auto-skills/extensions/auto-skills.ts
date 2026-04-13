import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  REVIEW_ENTRY_TYPE,
  REVIEW_MARKER,
  type ReviewLedgerEntry,
  type ReviewPhase,
  buildAutoSkillReviewPrompt,
  createSkill,
  extractLatestReviewLedger,
  hashReviewFingerprint,
  patchSkill,
  shouldTriggerAutoSkillReview,
  writeSkillFile,
} from "./auto-skills-core.ts";

const TOOL_PARAMS = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("patch"), Type.Literal("write_file")]),
  name: Type.String({ description: "Skill name" }),
  content: Type.Optional(Type.String({ description: "Full SKILL.md content" })),
  oldString: Type.Optional(Type.String({ description: "Exact text to replace for patch" })),
  newString: Type.Optional(Type.String({ description: "Replacement text for patch" })),
  replaceAll: Type.Optional(Type.Boolean({ description: "Replace all matches for patch" })),
  filePath: Type.Optional(Type.String({ description: "Supporting file path under references/, templates/, scripts/, or assets/" })),
  fileContent: Type.Optional(Type.String({ description: "Supporting file content" })),
});

type Action = "create" | "patch" | "write_file";

type ReviewRuntimeState = {
  phase: ReviewPhase;
  currentPrompt?: string;
  currentFingerprint?: string;
  lastReviewedFingerprint?: string;
  lastReviewAction: "none" | "create" | "patch";
  lastSkillName?: string;
  reviewQueued: boolean;
  inReviewTurn: boolean;
  reviewCompletedForRun: boolean;
  toolCalls: number;
  readCount: number;
  writeCount: number;
  toolErrors: number;
  hadRecovery: boolean;
  toolNames: Set<string>;
  touchedPaths: Set<string>;
  turnCount: number;
  meaningfulAssistantTurns: number;
  autoskillUsed: boolean;
};

function createEmptyState(): ReviewRuntimeState {
  return {
    phase: "idle",
    lastReviewAction: "none",
    reviewQueued: false,
    inReviewTurn: false,
    reviewCompletedForRun: false,
    toolCalls: 0,
    readCount: 0,
    writeCount: 0,
    toolErrors: 0,
    hadRecovery: false,
    toolNames: new Set(),
    touchedPaths: new Set(),
    turnCount: 0,
    meaningfulAssistantTurns: 0,
    autoskillUsed: false,
  };
}

function queueRuntimeReload(pi: ExtensionAPI) {
  pi.sendUserMessage("/autoskill-reload", { deliverAs: "followUp" });
}

function isReviewPrompt(text: unknown) {
  return typeof text === "string" && text.includes(REVIEW_MARKER);
}

function extractPromptText(prompt: unknown) {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .filter((part): part is { type: string; text?: string } => !!part && typeof part === "object" && "type" in part)
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("\n");
  }
  return "";
}

function extractTouchedPaths(toolName: string, input: Record<string, unknown>) {
  const candidates: string[] = [];
  if (toolName === "read" || toolName === "write") {
    if (typeof input.path === "string") candidates.push(input.path);
  }
  if (toolName === "edit") {
    if (typeof input.path === "string") candidates.push(input.path);
  }
  if (toolName === "auto_skill_manage") {
    if (typeof input.name === "string") candidates.push(`~/.agents/skills/auto/${input.name}/SKILL.md`);
    if (typeof input.filePath === "string" && typeof input.name === "string") {
      candidates.push(`~/.agents/skills/auto/${input.name}/${input.filePath}`);
    }
  }
  return candidates;
}

function persistReviewState(pi: ExtensionAPI, state: ReviewRuntimeState) {
  const fingerprint = state.currentFingerprint ?? state.lastReviewedFingerprint;
  if (!fingerprint) return;

  const entry: ReviewLedgerEntry = {
    version: 1,
    fingerprint,
    phase: state.phase,
    action: state.lastReviewAction,
    skillName: state.lastSkillName,
    timestamp: Date.now(),
  };
  pi.appendEntry(REVIEW_ENTRY_TYPE, entry);
}

function resetRunState(state: ReviewRuntimeState, prompt: string) {
  state.phase = "collecting";
  state.currentPrompt = prompt;
  state.currentFingerprint = undefined;
  state.reviewQueued = false;
  state.inReviewTurn = false;
  state.reviewCompletedForRun = false;
  state.toolCalls = 0;
  state.readCount = 0;
  state.writeCount = 0;
  state.toolErrors = 0;
  state.hadRecovery = false;
  state.toolNames.clear();
  state.touchedPaths.clear();
  state.turnCount = 0;
  state.meaningfulAssistantTurns = 0;
  state.autoskillUsed = false;
  state.lastReviewAction = "none";
  state.lastSkillName = undefined;
}

export default function autoSkillsExtension(pi: ExtensionAPI) {
  const state = createEmptyState();

  pi.registerCommand("autoskill-reload", {
    description: "Reload runtime after auto-skill changes",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerTool({
    name: "auto_skill_manage",
    label: "Auto Skill Manage",
    description: "Create and update auto-managed skills in ~/.agents/skills/auto/ so reusable workflows become procedural memory.",
    promptSnippet: "Create or patch shared auto-managed skills for reusable workflows discovered during work.",
    promptGuidelines: [
      "After completing a complex task (especially 5+ tool calls), fixing a tricky error, or discovering a reusable workflow, save the approach with auto_skill_manage.",
      "Use skills for procedures, not facts or temporary task state.",
      "Prefer patching an existing auto skill when you discover missing pitfalls, verification steps, or corrections.",
      "Do not wait to be asked if the workflow would help in a future session.",
      "Skip simple one-off tasks.",
      "Good skills include when to use, numbered steps, pitfalls, and verification steps.",
    ],
    parameters: TOOL_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action = params.action as Action;
      let result: Record<string, unknown>;

      if (action === "create") {
        result = createSkill(params.name, params.content ?? "");
      } else if (action === "patch") {
        result = patchSkill(params.name, params.oldString ?? "", params.newString ?? "", params.filePath, params.replaceAll ?? false);
      } else {
        result = writeSkillFile(params.name, params.filePath ?? "", params.fileContent ?? "");
      }

      if (result.success) {
        state.autoskillUsed = true;
        state.lastReviewAction = action === "patch" ? "patch" : action === "create" ? "create" : state.lastReviewAction;
        state.lastSkillName = params.name;
        state.reviewCompletedForRun = true;
        state.phase = state.inReviewTurn ? "review_done" : state.phase;
        persistReviewState(pi, state);
        if (ctx.hasUI) ctx.ui.notify(String(result.message), "info");
        queueRuntimeReload(pi);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  pi.registerCommand("autoskill-now", {
    description: "Ask the agent to capture the current workflow as an auto skill now",
    handler: async (_args, ctx) => {
      const message = [
        "Capture the reusable workflow from this conversation as an auto-managed skill now.",
        "Use auto_skill_manage.",
        "Prefer action='patch' if an existing auto skill already fits.",
        "Otherwise create a new skill in ~/.agents/skills/auto/.",
        "Only save procedural steps, pitfalls, and verification guidance. Do not save facts or temporary task state.",
      ].join(" ");

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
        if (ctx.hasUI) ctx.ui.notify("Queued auto-skill capture as follow-up", "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const latest = extractLatestReviewLedger(ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>);
    if (!latest) return;
    state.phase = latest.phase;
    state.lastReviewedFingerprint = latest.fingerprint;
    state.lastReviewAction = latest.action;
    state.lastSkillName = latest.skillName;
  });

  pi.on("input", async (event) => {
    if (event.source === "extension" && isReviewPrompt(event.text)) {
      state.phase = "review_running";
      state.inReviewTurn = true;
      state.reviewQueued = false;
      persistReviewState(pi, state);
    }
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event) => {
    const promptText = extractPromptText(event.prompt);
    const reviewTurn = isReviewPrompt(promptText);

    if (!reviewTurn) {
      resetRunState(state, promptText);
    } else {
      state.inReviewTurn = true;
      state.phase = "review_running";
    }

    const baseGuidance = `\n\n## Auto Skills\n\nAfter completing a complex task (especially 5+ tool calls), fixing a tricky error, or discovering a reusable workflow, you must consider whether to save or patch an auto-managed skill with auto_skill_manage.\n\n- Skills are procedural memory: save how to do something, not facts or temporary task state.\n- Prefer patching an existing auto skill when you discover missing pitfalls, verification steps, or corrections.\n- Do not wait to be asked if the workflow would help in a future session.\n- Skip simple one-off tasks.\n- Good skills include: when to use, numbered steps, exact commands when possible, pitfalls, and verification steps.\n- Auto-managed skills live only in ~/.agents/skills/auto/.\n`;

    const reviewGuidance = reviewTurn
      ? `\n\n## Auto Skill Review Turn\n\nThis is an internal reflection turn. Either create or patch a reusable auto-managed skill with auto_skill_manage, or reply exactly 'Nothing to save.' if the prior task produced no durable procedural learning.\n`
      : "";

    return {
      systemPrompt: event.systemPrompt + baseGuidance + reviewGuidance,
    };
  });

  pi.on("tool_execution_start", async (event) => {
    state.toolCalls += 1;
    state.toolNames.add(event.toolName);

    if (event.toolName === "read") state.readCount += 1;
    if (event.toolName === "write" || event.toolName === "edit") state.writeCount += 1;
    if (event.toolName === "auto_skill_manage") state.autoskillUsed = true;

    for (const touched of extractTouchedPaths(event.toolName, (event.args ?? {}) as Record<string, unknown>)) {
      state.touchedPaths.add(touched);
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.isError) {
      state.toolErrors += 1;
    } else if (state.toolErrors > 0) {
      state.hadRecovery = true;
    }
  });

  pi.on("turn_end", async (event) => {
    state.turnCount += 1;
    if (Array.isArray(event.message?.content)) {
      const text = event.message.content
        .filter((part: { type?: string; text?: string }) => part?.type === "text" && typeof part.text === "string")
        .map((part: { text?: string }) => part.text ?? "")
        .join("\n")
        .trim();
      if (text && text !== "Nothing to save.") state.meaningfulAssistantTurns += 1;
    }
  });

  pi.on("agent_end", async () => {
    if (state.inReviewTurn) {
      state.phase = "review_done";
      state.reviewCompletedForRun = true;
      state.lastReviewedFingerprint = state.currentFingerprint ?? state.lastReviewedFingerprint;
      persistReviewState(pi, state);
      state.inReviewTurn = false;
      return;
    }

    if (state.reviewQueued || state.reviewCompletedForRun || state.autoskillUsed) return;

    const fingerprint = hashReviewFingerprint({
      prompt: state.currentPrompt,
      toolNames: state.toolNames,
      touchedPaths: state.touchedPaths,
      toolCalls: state.toolCalls,
      writeCount: state.writeCount,
      readCount: state.readCount,
      toolErrors: state.toolErrors,
      hadRecovery: state.hadRecovery,
      turnCount: state.turnCount,
    });
    state.currentFingerprint = fingerprint;

    const shouldReview = shouldTriggerAutoSkillReview({
      toolCalls: state.toolCalls,
      readCount: state.readCount,
      writeCount: state.writeCount,
      touchedPaths: Array.from(state.touchedPaths),
      toolErrors: state.toolErrors,
      hadRecovery: state.hadRecovery,
      turnCount: state.turnCount,
      meaningfulAssistantTurns: state.meaningfulAssistantTurns,
      autoskillUsed: state.autoskillUsed,
    });

    if (!shouldReview || state.lastReviewedFingerprint === fingerprint) {
      state.phase = "idle";
      persistReviewState(pi, state);
      return;
    }

    state.phase = "review_queued";
    state.reviewQueued = true;
    persistReviewState(pi, state);
    pi.sendUserMessage(buildAutoSkillReviewPrompt(), { deliverAs: "followUp" });
  });

  pi.on("session_before_compact", async () => {
    persistReviewState(pi, state);
  });

  pi.on("session_shutdown", async () => {
    persistReviewState(pi, state);
  });
}
