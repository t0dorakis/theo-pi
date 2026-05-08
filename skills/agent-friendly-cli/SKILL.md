---
name: agent-friendly-cli
description: Design, implement, or review CLI command surfaces for reliable AI-agent and script use. Use when adding or evaluating command flags, JSON output, non-interactive behavior, stdout/stderr behavior, exit codes, errors, idempotency, async polling, introspection, or CLI acceptance criteria.
---

# Agent-Friendly CLI

Use this skill for CLI design, implementation, review, or acceptance criteria when AI agents or automation are first-class callers.

## Core Standard

An agent-friendly CLI can be invoked without hidden interaction, parsed deterministically, retried safely, inspected structurally, and learned through consistent conventions.

Design for agents as primary users. Humans benefit from the same properties: predictable output, durable state, recoverable async workflows, and consistent naming.

## Workflow

For review:

1. Inspect command schema, help text, docs, and tests.
2. Check the required baseline below first.
3. Run or request focused checks for closed stdin, non-TTY output, `--json`, exit codes, and stderr/stdout separation when feasible.
4. Report findings by severity with exact command examples and test gaps.

For implementation:

1. Identify affected commands and existing CLI conventions.
2. Preserve established naming unless it directly conflicts with the required baseline.
3. Add the smallest command-surface changes needed.
4. Add focused tests for machine behavior, not only human output.

For acceptance criteria:

1. Convert the relevant checklist items into testable command cases.
2. Specify command, stdin/TTY mode, expected exit code, stdout schema, stderr schema/text, and side effects.
3. Include negative cases for invalid values, prompts, truncation, and retries when relevant.

## Required Baseline

Every agent-callable CLI should provide:

- **Non-interactive execution**: never hang on prompts in headless mode. `--no-input` means never prompt and fail fast if required input or confirmation is missing. `--force` is only a destructive confirmation bypass, not a general error bypass.
- **Structured output**: one JSON convention across the CLI, preferably `--json`.
- **Clear stream policy**: machine data on stdout; diagnostics/progress on stderr. In JSON mode, choose one project-wide failure policy and document it: either JSON error object on stdout or JSON error object on stderr with empty stdout. Do not mix per command.
- **ANSI discipline**: decide color per stream; never emit ANSI to a non-TTY stream unless explicitly forced. Honor `NO_COLOR`/`FORCE_COLOR` when the project supports them.
- **Actionable errors**: validate before side effects; invalid enum/schema errors must enumerate valid values and include the received value.
- **Bounded output**: list/log/search commands need limits, pagination, truncation hints, or explicit continuation.
- **Vocabulary consistency**: use common verbs and flags consistently, such as `get`, `list`, `create`, `update`, `delete`, `--json`, `--force`, and `--limit`.

## Conditional Standards

Apply these only when the CLI shape warrants them:

- **Mutations**: require explicit mutation boundaries, IDs in responses, and idempotency keys or true natural keys. Do not infer uniqueness from content/body fields unless the domain explicitly defines that uniqueness.
- **Async submissions**: provide `--wait`, backoff with jitter, durable job ledgers, and `jobs list/get/prune`. Persist enough correlation data to resume safely: job ID, request/idempotency key, profile/account namespace, command, and input digest.
- **Profiles**: for recurring configuration, support profile save/list/get/delete, `--profile <name>`, precedence `explicit flag > environment variable > profile > default`, safe storage permissions, and redaction in `profile get` and `agent-context`.
- **Artifact delivery**: for artifact-producing commands, support explicit delivery sinks such as stdout, atomic file output, and webhooks. Define parsing and security rules for paths/URLs.
- **Feedback**: when agents are expected to encounter maintainable friction, provide local JSONL feedback capture and optional upstream posting, surfaced through introspection.
- **Broad platform CLIs**: use schema/codegen or static validation for help, docs, SDKs, MCP tools, Terraform providers, skill manifests, naming policy, and drift checks.

## References

Read only what the task needs:

- [review-checklist.md](references/review-checklist.md): detailed review checklist and severity guidance.
- [implementation.md](references/implementation.md): implementation rules, tests, JSON/error policy, idempotency, and security details.
- [advanced-patterns.md](references/advanced-patterns.md): async, profiles, delivery, feedback, introspection, schema/codegen, and MCP/tool budgets.
- [examples.md](references/examples.md): command examples and expected outputs.

## Pitfalls

- A command that waits for confirmation under closed stdin is broken for agents.
- `--json` on some commands but not others is friction.
- Vague enum errors force help parsing and retries.
- Retried creates without stable idempotency can duplicate resources.
- Hand-maintained broad CLI surfaces drift; enforce consistency mechanically.
