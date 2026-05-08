# Advanced Patterns

Use this for broad platform CLIs, async APIs, persistent identity, artifact workflows, or generated command surfaces.

## Three-Layer Introspection

1. `--help`: human-shaped command summary and usage.
2. `agent-context`: structured, versioned JSON describing commands, flags, exit codes, profiles, delivery schemes, feedback availability, and schema version.
3. Skill manifests or task guides: long-form workflow instructions for composing commands.

Keep all layers generated or validated against the same command source.

## Async Workflows

Submitting commands that wrap async APIs should provide:

- `--wait`
- exponential backoff with jitter
- durable ledger such as `~/.<cli>/jobs.jsonl`
- `jobs list`
- `jobs get <id>`
- `jobs prune`
- resume correlation using request/idempotency key and input digest

Without `--wait`, agents write fragile polling loops. Without a ledger and correlation data, retries can duplicate long-running work.

## Profiles

Profiles reduce repeated flags across sessions.

Recommended commands:

- `profile save <name>`
- `profile list`
- `profile get <name>`
- `profile delete <name>`

Recommended precedence:

```text
explicit flag > environment variable > profile > default
```

Expose profile names, not secrets, through `agent-context`.

## Delivery and Feedback

Delivery schemes route artifacts directly:

- `stdout`
- `file:<path>` or equivalent path flag
- `webhook:<url>`

Feedback closes the loop:

- `feedback <text>` writes local JSONL by default.
- Optional configured endpoint POSTs upstream.
- `agent-context` should expose whether upstream feedback is configured.

## Schema and Codegen

For broad CLIs, define the command surface from a typed schema and generate or validate:

- CLI command definitions
- help text
- `agent-context`
- docs
- SDKs
- MCP tools
- Terraform providers or other IaC bindings
- skill manifests

Build-time checks should cover:

- vocabulary policy and banned aliases
- `--json` coverage
- non-interactive prompt behavior
- exit code taxonomy
- enum-error valid-value enumeration
- async `--wait` and ledger support
- profile precedence
- delivery schemes
- feedback discoverability
- MCP/tool description budgets
- drift between implementation and documentation surfaces
