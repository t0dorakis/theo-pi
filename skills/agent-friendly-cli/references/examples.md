# Examples

Use these as patterns, not as mandatory command names.

## Destructive Command

```bash
mycli post delete post_8f2a --force --json
```

Expected stdout:

```json
{"deleted":"post_8f2a"}
```

Expected exit code: `0`.

## Invalid Enum

```bash
mycli post create --json --visibility=secret --content="hi"
```

Expected JSON error detail should include:

```json
{"error":{"code":"invalid_enum","field":"--visibility","valid_values":["public","private","unlisted"],"got":"secret"}}
```

Place the JSON error object on stdout or stderr according to the CLI's documented JSON failure policy.

## Idempotent Create

```bash
mycli post create --json --idempotency-key req_123 --content="hello world"
mycli post create --json --idempotency-key req_123 --content="hello world"
```

Expected second response:

```json
{"id":"post_8f2a","existing":true}
```

If the same key is reused with different inputs, return a conflict:

```json
{"error":{"code":"idempotency_key_conflict","key":"req_123","message":"idempotency key was already used with different inputs"}}
```

## Agent Context

```bash
mycli agent-context | jq '.schema_version, .commands.post.subcommands.create.flags'
```

Example flag shape:

```json
{
  "--content": {"type":"string","required":true},
  "--visibility": {"type":"enum","values":["public","private","unlisted"]},
  "--json": {"type":"bool","default":false},
  "--dry-run": {"type":"bool","default":false}
}
```

## Async Wait and Ledger

```bash
mycli video render --script=story.txt --wait --json
mycli jobs list --json
mycli jobs get job_8f2a --json
mycli jobs prune --older-than=30d --json
```

Expected completed response:

```json
{"job_id":"job_8f2a","status":"complete","url":"https://.../out.mp4"}
```

## Profiles

```bash
mycli profile save my-podcast --avatar=lila --voice=warm-en --webhook=https://podcast.example.com/hook
mycli video create --profile=my-podcast --script=ep_42.txt --json
mycli agent-context | jq '.available_profiles'
```

Expected precedence:

```text
explicit flag > environment variable > profile > default
```

## Delivery and Feedback

```bash
mycli video create --script=story.txt --deliver=file:./out.mp4 --json
mycli video create --script=story.txt --deliver=s3:bucket/key --json
mycli feedback "the --tier flag rejects 'enterprise' but the docs list it as valid"
mycli feedback list --json
```

Expected invalid delivery detail:

```json
{"error":{"code":"invalid_delivery_scheme","valid_schemes":["stdout","file:<path>","webhook:<url>"],"got":"s3"}}
```

Expected feedback context:

```json
{
  "delivery_schemes": ["stdout", "file:<path>", "webhook:<url>"],
  "feedback": {
    "local": true,
    "upstream_configured": false
  }
}
```
