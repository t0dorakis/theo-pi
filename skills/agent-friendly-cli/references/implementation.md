# Implementation Guidance

Use this when changing command behavior or writing acceptance criteria.

## Acceptance Case Shape

For each machine-facing behavior, specify:

- command
- stdin and TTY mode
- expected exit code
- stdout JSON/schema
- stderr text/schema
- side effects
- files/network calls created or avoided

## JSON Failure Policy

Pick one project-wide policy and enforce it everywhere:

1. JSON error object on stdout, diagnostics/progress on stderr.
2. Empty stdout on failure, JSON error object on stderr.

Do not mix these policies by command. In either policy, the JSON error object should include stable fields such as `error.code`, `error.message`, and relevant details like `valid_values`.

## Idempotency

Use explicit idempotency keys or true domain natural keys:

- Good: `--idempotency-key req_123`
- Good: `--slug hello-world` when slugs are unique by design
- Risky: deduplicating by free-form body/content unless the product explicitly defines that uniqueness

For async submissions, persist correlation data:

- remote job ID
- request/idempotency key
- profile/account namespace
- command name
- input digest
- submitted timestamp

If the same idempotency key is reused with different inputs, do not return the prior result and do not create new work. Return a stable conflict error that includes the key, the mismatch class, and the recovery path.

Test the failure mode: process killed after submit but before completion; rerun command; no second remote job is created.

## Profiles and Secrets

- Store config files with restrictive permissions where the platform supports it.
- Do not store API keys or bearer tokens in plaintext profiles when an OS keychain, credential store, or environment variable is available.
- Redact secrets and sensitive webhook URLs in `profile get`, `profile list`, logs, errors, and `agent-context`.
- Test that sensitive fields are not printed.

## Delivery Security

For `--deliver=<scheme>`:

- Define parsing rules for schemes and escaping. If colon schemes are ambiguous on the target platforms, prefer separate flags such as `--deliver=file --output <path>`.
- Write file sinks atomically in the destination directory: temp file, fsync when appropriate, rename.
- Surface webhook HTTP status and enough response detail for recovery.
- Configure webhook timeouts and bounded retries.
- In hosted or multi-tenant contexts, restrict private-network URLs and other SSRF-prone destinations.

## Focused Tests

Add tests for:

- closed stdin prompt path
- non-TTY JSON output with no ANSI bytes
- invalid enum includes valid values
- documented exit code taxonomy
- stdout/stderr separation
- bounded/truncated output hints
- idempotent retry
- async resume after killed wait
- profile precedence and redaction
- unknown delivery scheme enumerates valid schemes
