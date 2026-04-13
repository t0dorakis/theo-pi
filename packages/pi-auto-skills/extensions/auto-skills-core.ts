import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";

export const REVIEW_ENTRY_TYPE = "auto-skills-review";
export const REVIEW_MARKER = "<pi_auto_skill_review>";

export type ReviewPhase = "idle" | "collecting" | "review_queued" | "review_running" | "review_done";

const REVIEW_PHASES: ReadonlySet<ReviewPhase> = new Set(["idle", "collecting", "review_queued", "review_running", "review_done"]);

export interface ReviewSignals {
  toolCalls: number;
  readCount: number;
  writeCount: number;
  touchedPaths: string[];
  toolErrors: number;
  hadRecovery: boolean;
  turnCount: number;
  meaningfulAssistantTurns: number;
  autoskillUsed: boolean;
}

export interface ReviewLedgerEntry {
  version: 1;
  fingerprint: string;
  phase: ReviewPhase;
  action: "none" | "create" | "patch";
  skillName?: string;
  timestamp: number;
}

export const AUTO_SKILLS_ROOT = path.join(os.homedir(), ".agents", "skills", "auto");
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_CONTENT_CHARS = 100_000;
export const MAX_SKILL_FILE_BYTES = 1_048_576;
export const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const ALLOWED_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function getAutoSkillsRoot() {
  ensureDir(AUTO_SKILLS_ROOT);
  return AUTO_SKILLS_ROOT;
}

export function validateName(name: string): string | undefined {
  if (!name) return "Skill name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!VALID_NAME_RE.test(name)) {
    return `Invalid skill name '${name}'. Use lowercase letters, numbers, hyphens, dots, and underscores. Must start with a letter or digit.`;
  }
  return undefined;
}

export function validateContentSize(content: string, label = "SKILL.md"): string | undefined {
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    return `${label} content is ${content.length.toLocaleString()} characters (limit: ${MAX_SKILL_CONTENT_CHARS.toLocaleString()}).`;
  }
  return undefined;
}

export function validateSkillContent(content: string, expectedName?: string): string | undefined {
  if (!content.trim()) return "Content cannot be empty.";
  if (!content.startsWith("---")) return "SKILL.md must start with YAML frontmatter (---).";

  const match = content.slice(3).match(/\n---\s*\n/);
  if (!match || match.index == null) return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line.";

  const yamlContent = content.slice(3, match.index + 3);
  let parsed: any;
  try {
    parsed = yaml.load(yamlContent);
  } catch (error) {
    return `YAML frontmatter parse error: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Frontmatter must be a YAML mapping (key: value pairs).";
  if (!parsed.name) return "Frontmatter must include 'name' field.";
  if (expectedName && String(parsed.name) !== expectedName) {
    return `Frontmatter name '${String(parsed.name)}' must match skill name '${expectedName}'.`;
  }
  if (!parsed.description) return "Frontmatter must include 'description' field.";
  if (String(parsed.description).length > MAX_DESCRIPTION_LENGTH) {
    return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  const body = content.slice(match.index + 3 + match[0].length).trim();
  if (!body) return "SKILL.md must have content after the frontmatter.";

  return validateContentSize(content);
}

export function validateFilePath(filePath: string): string | undefined {
  if (!filePath) return "filePath is required.";
  if (path.isAbsolute(filePath)) return "Absolute file paths are not allowed.";
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    return "Path traversal ('..') is not allowed.";
  }
  const parts = normalized.split("/");
  if (!parts[0] || !ALLOWED_SUBDIRS.has(parts[0])) {
    return `File must be under one of: ${Array.from(ALLOWED_SUBDIRS).sort().join(", ")}. Got: '${filePath}'`;
  }
  if (parts.length < 2) return `Provide a file path, not just a directory. Example: '${parts[0]}/myfile.md'`;
  return undefined;
}

export function resolveSkillDir(name: string) {
  return path.join(getAutoSkillsRoot(), name);
}

export function resolveWithin(root: string, relativePath: string): { path?: string; error?: string } {
  const candidate = path.resolve(root, relativePath);
  const resolvedRoot = fs.realpathSync(root);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    const parent = path.dirname(candidate);
    if (fs.existsSync(parent)) {
      const resolvedParent = fs.realpathSync(parent);
      if (!(resolvedParent === resolvedRoot || resolvedParent.startsWith(resolvedRoot + path.sep))) {
        return { error: `Resolved path escapes skill directory: ${relativePath}` };
      }
    }
    return { path: candidate };
  }
  return { error: `Resolved path escapes skill directory: ${relativePath}` };
}

export function atomicWriteText(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export function skillExists(name: string) {
  return fs.existsSync(path.join(resolveSkillDir(name), "SKILL.md"));
}

export function injectMetadata(content: string) {
  const now = new Date().toISOString();
  const match = content.slice(3).match(/\n---\s*\n/);
  if (!match || match.index == null) return content;
  const yamlContent = content.slice(3, match.index + 3);
  const parsed = (yaml.load(yamlContent) as Record<string, unknown>) || {};
  parsed.source = parsed.source ?? "pi-auto";
  parsed.created_by = parsed.created_by ?? "pi-auto-skills";
  parsed.auto_generated = parsed.auto_generated ?? true;
  parsed.created_at = parsed.created_at ?? now;
  parsed.updated_at = now;
  const dumped = yaml.dump(parsed, { lineWidth: 120 }).trimEnd();
  const bodyStart = match.index + 3 + match[0].length;
  return `---\n${dumped}\n---\n` + content.slice(bodyStart).replace(/^\n*/, "");
}

function findLineTrimmedMatchRanges(content: string, needle: string): Array<{ start: number; end: number }> {
  const trimmedNeedleLines = needle
    .split("\n")
    .map((line) => line.trim())
    .filter((_, index, arr) => !(index === arr.length - 1 && arr[index] === ""));

  if (trimmedNeedleLines.length === 0) return [];

  const lines = content.split("\n");
  const ranges: Array<{ start: number; end: number }> = [];

  for (let i = 0; i <= lines.length - trimmedNeedleLines.length; i++) {
    const window = lines.slice(i, i + trimmedNeedleLines.length).map((line) => line.trim());
    const matches = window.every((line, index) => line === trimmedNeedleLines[index]);
    if (!matches) continue;

    const start = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
    const matchedText = lines.slice(i, i + trimmedNeedleLines.length).join("\n");
    ranges.push({ start, end: start + matchedText.length });
  }

  return ranges;
}

export function createSkill(name: string, content: string) {
  const nameError = validateName(name);
  if (nameError) return { success: false, error: nameError };
  const contentError = validateSkillContent(content, name);
  if (contentError) return { success: false, error: contentError };
  if (skillExists(name)) {
    return { success: false, error: `Auto skill '${name}' already exists. Use action='patch' instead.` };
  }

  const skillDir = resolveSkillDir(name);
  ensureDir(skillDir);
  const skillContent = injectMetadata(content);
  const skillMdPath = path.join(skillDir, "SKILL.md");
  atomicWriteText(skillMdPath, skillContent);
  return {
    success: true,
    action: "create",
    name,
    path: skillMdPath,
    message: `Auto-saved skill: ${name}`,
  };
}

export function patchSkill(name: string, oldString: string, newString: string, filePath?: string, replaceAll = false) {
  const nameError = validateName(name);
  if (nameError) return { success: false, error: nameError };
  if (!oldString) return { success: false, error: "oldString is required for patch." };
  if (newString == null) return { success: false, error: "newString is required for patch." };
  if (!skillExists(name)) return { success: false, error: `Auto skill '${name}' not found.` };

  const skillDir = resolveSkillDir(name);
  let targetPath = path.join(skillDir, "SKILL.md");
  if (filePath) {
    const fileError = validateFilePath(filePath);
    if (fileError) return { success: false, error: fileError };
    const resolved = resolveWithin(skillDir, filePath);
    if (resolved.error || !resolved.path) return { success: false, error: resolved.error ?? "Invalid file path." };
    targetPath = resolved.path;
  }
  if (!fs.existsSync(targetPath)) return { success: false, error: `File not found: ${filePath ?? "SKILL.md"}` };

  const original = fs.readFileSync(targetPath, "utf8");
  const exactOccurrences = original.split(oldString).length - 1;
  let next: string | undefined;
  let strategy = "exact";

  if (exactOccurrences > 0) {
    if (!replaceAll && exactOccurrences > 1) {
      return { success: false, error: `Patch target is ambiguous (${exactOccurrences} matches). Use replaceAll=true or provide more context.` };
    }
    next = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString);
  } else {
    const ranges = findLineTrimmedMatchRanges(original, oldString);
    if (ranges.length === 0) {
      return {
        success: false,
        error: "Patch target not found.",
        filePreview: original.slice(0, 500) + (original.length > 500 ? "..." : ""),
      };
    }
    if (replaceAll) {
      let rebuilt = original;
      for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        rebuilt = rebuilt.slice(0, range.start) + newString + rebuilt.slice(range.end);
      }
      next = rebuilt;
      strategy = "line-trimmed-replace-all";
    } else {
      if (ranges.length > 1) {
        return { success: false, error: `Patch target is ambiguous (${ranges.length} matches). Use replaceAll=true or provide more context.` };
      }
      const range = ranges[0];
      next = original.slice(0, range.start) + newString + original.slice(range.end);
      strategy = "line-trimmed";
    }
  }

  const sizeError = validateContentSize(next, filePath ?? "SKILL.md");
  if (sizeError) return { success: false, error: sizeError };
  if (!filePath) {
    const validationError = validateSkillContent(next, name);
    if (validationError) return { success: false, error: `Patch would break SKILL.md structure: ${validationError}` };
  }

  atomicWriteText(targetPath, next);
  return {
    success: true,
    action: "patch",
    name,
    path: targetPath,
    strategy,
    message: `Updated auto skill: ${name}`,
  };
}

export function writeSkillFile(name: string, filePath: string, fileContent: string) {
  const nameError = validateName(name);
  if (nameError) return { success: false, error: nameError };
  if (!skillExists(name)) return { success: false, error: `Auto skill '${name}' not found.` };
  const fileError = validateFilePath(filePath);
  if (fileError) return { success: false, error: fileError };
  if (fileContent == null) return { success: false, error: "fileContent is required for write_file." };
  const bytes = Buffer.byteLength(fileContent, "utf8");
  if (bytes > MAX_SKILL_FILE_BYTES) {
    return { success: false, error: `File content is ${bytes.toLocaleString()} bytes (limit: ${MAX_SKILL_FILE_BYTES.toLocaleString()} bytes).` };
  }
  const sizeError = validateContentSize(fileContent, filePath);
  if (sizeError) return { success: false, error: sizeError };

  const skillDir = resolveSkillDir(name);
  const resolved = resolveWithin(skillDir, filePath);
  if (resolved.error || !resolved.path) return { success: false, error: resolved.error ?? "Invalid file path." };
  atomicWriteText(resolved.path, fileContent);
  return {
    success: true,
    action: "write_file",
    name,
    path: resolved.path,
    message: `Wrote ${filePath} in auto skill: ${name}`,
  };
}

export function hashReviewFingerprint(input: {
  prompt?: string;
  toolNames: Iterable<string>;
  touchedPaths: Iterable<string>;
  toolCalls: number;
  writeCount: number;
  readCount: number;
  toolErrors: number;
  hadRecovery: boolean;
  turnCount: number;
}) {
  const payload = JSON.stringify({
    prompt: (input.prompt ?? "").trim().replace(/\s+/g, " ").slice(0, 500),
    toolNames: Array.from(input.toolNames).sort(),
    touchedPaths: Array.from(input.touchedPaths).sort(),
    toolCalls: input.toolCalls,
    writeCount: input.writeCount,
    readCount: input.readCount,
    toolErrors: input.toolErrors,
    hadRecovery: input.hadRecovery,
    turnCount: input.turnCount,
  });
  return crypto.createHash("sha1").update(payload).digest("hex");
}

export function shouldTriggerAutoSkillReview(signals: ReviewSignals) {
  const substantialExecution =
    signals.toolCalls >= 5 ||
    (signals.writeCount >= 1 && signals.readCount >= 2) ||
    signals.touchedPaths.length >= 2 ||
    (signals.toolErrors >= 1 && signals.hadRecovery) ||
    (signals.turnCount >= 2 && signals.toolCalls >= 2);

  const plausibleReuse =
    (signals.writeCount >= 1 && signals.readCount >= 2) ||
    signals.touchedPaths.length >= 2 ||
    (signals.toolErrors >= 1 && signals.hadRecovery) ||
    signals.meaningfulAssistantTurns >= 2;

  return substantialExecution && plausibleReuse && !signals.autoskillUsed;
}

export function buildAutoSkillReviewPrompt() {
  return [
    REVIEW_MARKER,
    "Review the immediately preceding task and decide whether a reusable auto-managed skill should be created or patched.",
    "",
    "Create or patch a skill only if:",
    "- the task involved a non-trivial workflow,",
    "- or required trial-and-error or recovery,",
    "- or produced a reusable procedure likely to help in future sessions.",
    "",
    "Prefer patching an existing relevant auto skill over creating a duplicate.",
    "Write only to ~/.agents/skills/auto/ via auto_skill_manage.",
    "",
    "If a new skill is warranted:",
    "- choose a specific, reusable name",
    "- write a focused SKILL.md with clear activation guidance and steps",
    "- include pitfalls and verification steps actually learned from the task",
    "- avoid generic names like 'prompt-created-auto-skill'",
    "",
    "If no durable reusable workflow was learned, do nothing and reply exactly:",
    "Nothing to save.",
    REVIEW_MARKER,
  ].join("\n");
}

export function extractLatestReviewLedger(entries: Array<{ type?: string; customType?: string; data?: unknown }>): ReviewLedgerEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom" && entry.customType === REVIEW_ENTRY_TYPE && entry.data && typeof entry.data === "object") {
      const data = entry.data as Partial<ReviewLedgerEntry>;
      if (typeof data.fingerprint === "string" && typeof data.phase === "string" && typeof data.timestamp === "number") {
        if (!REVIEW_PHASES.has(data.phase as ReviewPhase)) continue;
        return {
          version: 1,
          fingerprint: data.fingerprint,
          phase: data.phase as ReviewPhase,
          action: data.action === "create" || data.action === "patch" ? data.action : "none",
          skillName: typeof data.skillName === "string" ? data.skillName : undefined,
          timestamp: data.timestamp,
        };
      }
    }
  }
  return undefined;
}
