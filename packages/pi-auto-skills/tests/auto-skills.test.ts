import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  AUTO_SKILLS_ROOT,
  REVIEW_MARKER,
  buildAutoSkillReviewPrompt,
  createSkill,
  extractLatestReviewLedger,
  hashReviewFingerprint,
  patchSkill,
  shouldTriggerAutoSkillReview,
  validateFilePath,
  validateName,
  validateSkillContent,
  writeSkillFile,
} from "../extensions/auto-skills-core.ts";

const fixtureSkill = `---
name: test-skill
description: A test skill.
---

# Test Skill

## Steps
1. Do the thing.
2. Verify it.
`;

function cleanupSkill(name: string) {
  const dir = path.join(AUTO_SKILLS_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
}

test.before(() => {
  fs.mkdirSync(AUTO_SKILLS_ROOT, { recursive: true });
});

test.afterEach(() => {
  cleanupSkill("test-skill");
  cleanupSkill("indent-skill");
  cleanupSkill("with-ref");
});

test("validateName accepts safe names and rejects invalid ones", () => {
  assert.equal(validateName("my-skill"), undefined);
  assert.match(validateName("My Skill") ?? "", /Invalid skill name/);
});

test("validateSkillContent rejects missing frontmatter", () => {
  assert.match(validateSkillContent("# nope") ?? "", /frontmatter/i);
});

test("createSkill writes SKILL.md with metadata", () => {
  const result = createSkill("test-skill", fixtureSkill) as { success: boolean; path?: string };
  assert.equal(result.success, true);
  const written = fs.readFileSync(result.path!, "utf8");
  assert.match(written, /source: pi-auto/);
  assert.match(written, /created_by: pi-auto-skills/);
});

test("createSkill fails on duplicate names", () => {
  createSkill("test-skill", fixtureSkill);
  const duplicate = createSkill("test-skill", fixtureSkill) as { success: boolean; error?: string };
  assert.equal(duplicate.success, false);
  assert.match(duplicate.error ?? "", /already exists/);
});

test("createSkill enforces frontmatter name matches requested skill name", () => {
  const mismatched = fixtureSkill.replace("name: test-skill", "name: other-skill");
  const result = createSkill("test-skill", mismatched) as { success: boolean; error?: string };
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /must match skill name/);
});

test("patchSkill supports line-trimmed matching", () => {
  const content = `---
name: indent-skill
description: Indentation test.
---

# Indent Skill

## Steps
    1. First step
    2. Second step
`;
  createSkill("indent-skill", content);
  const result = patchSkill("indent-skill", "1. First step\n2. Second step", "1. Updated first\n2. Updated second") as {
    success: boolean;
    path?: string;
    strategy?: string;
  };
  assert.equal(result.success, true);
  assert.equal(result.strategy, "line-trimmed");
  const written = fs.readFileSync(result.path!, "utf8");
  assert.match(written, /Updated first/);
});

test("patchSkill rejects SKILL.md frontmatter name drift", () => {
  createSkill("test-skill", fixtureSkill);
  const result = patchSkill("test-skill", "name: test-skill", "name: renamed-skill") as { success: boolean; error?: string };
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /must match skill name/);
});

test("writeSkillFile only allows whitelisted subdirectories", () => {
  createSkill("with-ref", fixtureSkill.replace("name: test-skill", "name: with-ref"));
  assert.match(validateFilePath("references/api.md") ?? "ok", /ok/);
  assert.match(validateFilePath("secret/api.md") ?? "", /File must be under one of/);

  const result = writeSkillFile("with-ref", "references/api.md", "# API\n") as { success: boolean; path?: string };
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(result.path!), true);
});

test("writeSkillFile enforces byte limits", () => {
  createSkill("with-ref", fixtureSkill.replace("name: test-skill", "name: with-ref"));
  const huge = "x".repeat(1_048_577);
  const result = writeSkillFile("with-ref", "references/huge.md", huge) as { success: boolean; error?: string };
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /limit/i);
});

test("review fingerprint is stable regardless of ordering", () => {
  const a = hashReviewFingerprint({
    prompt: "Review package",
    toolNames: ["read", "bash"],
    touchedPaths: ["README.md", "package.json"],
    toolCalls: 6,
    writeCount: 1,
    readCount: 3,
    toolErrors: 0,
    hadRecovery: false,
    turnCount: 2,
  });
  const b = hashReviewFingerprint({
    prompt: "Review package",
    toolNames: ["bash", "read"],
    touchedPaths: ["package.json", "README.md"],
    toolCalls: 6,
    writeCount: 1,
    readCount: 3,
    toolErrors: 0,
    hadRecovery: false,
    turnCount: 2,
  });
  assert.equal(a, b);
});

test("shouldTriggerAutoSkillReview requires substantial reusable work", () => {
  assert.equal(
    shouldTriggerAutoSkillReview({
      toolCalls: 6,
      readCount: 3,
      writeCount: 1,
      touchedPaths: ["README.md", "package.json"],
      toolErrors: 0,
      hadRecovery: false,
      turnCount: 2,
      meaningfulAssistantTurns: 2,
      autoskillUsed: false,
    }),
    true,
  );

  assert.equal(
    shouldTriggerAutoSkillReview({
      toolCalls: 1,
      readCount: 1,
      writeCount: 0,
      touchedPaths: ["README.md"],
      toolErrors: 0,
      hadRecovery: false,
      turnCount: 1,
      meaningfulAssistantTurns: 1,
      autoskillUsed: false,
    }),
    false,
  );
});

test("shouldTriggerAutoSkillReview stays false once autoskill tool was already used", () => {
  assert.equal(
    shouldTriggerAutoSkillReview({
      toolCalls: 8,
      readCount: 4,
      writeCount: 2,
      touchedPaths: ["README.md", "extensions/auto-skills.ts"],
      toolErrors: 1,
      hadRecovery: true,
      turnCount: 3,
      meaningfulAssistantTurns: 2,
      autoskillUsed: true,
    }),
    false,
  );
});

test("buildAutoSkillReviewPrompt includes review marker and conservative save instruction", () => {
  const prompt = buildAutoSkillReviewPrompt();
  assert.match(prompt, new RegExp(REVIEW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(prompt, /reply exactly with a single period/);
  assert.match(prompt, /\n\.\n/);
  assert.match(prompt, /auto_skill_manage/);
  assert.match(prompt, /Only act if something is genuinely worth saving/);
  assert.match(prompt, /Do not save minor setup, install, reload, symlink, docs-only, or one-off housekeeping tasks/);
});

test("extractLatestReviewLedger returns latest persisted review entry", () => {
  const ledger = extractLatestReviewLedger([
    { type: "custom", customType: "other", data: {} },
    {
      type: "custom",
      customType: "auto-skills-review",
      data: {
        fingerprint: "abc123",
        phase: "review_done",
        action: "create",
        skillName: "review-npm-package",
        timestamp: 123,
      },
    },
  ]);

  assert.deepEqual(ledger, {
    version: 1,
    fingerprint: "abc123",
    phase: "review_done",
    action: "create",
    skillName: "review-npm-package",
    timestamp: 123,
  });
});

test("extractLatestReviewLedger skips malformed phase values and falls back to older valid entries", () => {
  const ledger = extractLatestReviewLedger([
    {
      type: "custom",
      customType: "auto-skills-review",
      data: {
        fingerprint: "older",
        phase: "review_queued",
        action: "patch",
        skillName: "good-skill",
        timestamp: 100,
      },
    },
    {
      type: "custom",
      customType: "auto-skills-review",
      data: {
        fingerprint: "newer-but-invalid",
        phase: "totally-invalid-phase",
        action: "create",
        skillName: "bad-skill",
        timestamp: 200,
      },
    },
  ]);

  assert.deepEqual(ledger, {
    version: 1,
    fingerprint: "older",
    phase: "review_queued",
    action: "patch",
    skillName: "good-skill",
    timestamp: 100,
  });
});
