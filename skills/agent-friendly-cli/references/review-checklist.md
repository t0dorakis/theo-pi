# Review Checklist

Use this when reviewing an existing CLI or command design.

## Severity

- **Blocker**: behavior can hang, corrupt state, duplicate work, hide failure, or make machine parsing unreliable.
- **Friction**: behavior is recoverable but costs extra help calls, retries, tokens, or custom parsing.
- **Optimization**: behavior compounds across repeated agent use or broad command surfaces.

## Required Checks

1. **Non-interactive behavior**
   - Closed stdin must not hang.
   - `--no-input` must fail fast instead of prompting.
   - Destructive commands must require explicit confirmation or `--force`.
   - `--force` must not bypass validation errors or permission failures.

2. **JSON and streams**
   - Every data-returning command supports the same JSON flag.
   - Success stdout is parseable and stable.
   - Diagnostics and progress do not pollute stdout.
   - JSON-mode failure policy is consistent across commands.
   - Exit codes are documented and tested.

3. **Errors**
   - Invalid enum/schema values enumerate the valid set.
   - Errors include the bad value, the affected flag/resource, and a recovery hint when feasible.
   - Validation happens before side effects.

4. **Output bounds**
   - Lists, logs, and search results default to bounded output.
   - Truncated responses include `truncated`, cursor/next fields, or narrowing hints.
   - MCP/tool descriptions have explicit token or character budgets.

5. **Vocabulary**
   - Commands use common verbs consistently: `get`, `list`, `create`, `update`, `delete`.
   - Avoid aliases like `ls`, `info`, `--format=json`, or `--skip-confirmations` unless the project has a documented compatibility reason.
   - Banned verbs and flag aliases are checked mechanically when the surface is broad.

## Conditional Checks

- Mutating commands: idempotency key or true natural key, returned IDs, `--dry-run` for consequential operations.
- Async commands: `--wait`, durable ledger, resume correlation data, `jobs list/get/prune`.
- Profiles: safe storage, redaction, precedence, discovery through `agent-context`.
- Delivery: atomic file writes, webhook status, strict path/URL parsing, supported schemes in errors.
- Feedback: local capture, optional upstream, discoverable availability.
- Introspection: `--help`, `agent-context`, MCP/schema/docs/skill manifests generated or validated together.
