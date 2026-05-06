# ACP Observatory

Effect + React observatory for live ACP/ACPX agent traces.

## Rendering decision

Primary canvas uses **SVG**, not HTML boxes or `<canvas>`.

Why:

- Abstract glyphs are vector shapes that need crisp scaling and poster-like visual quality.
- Per-glyph hover/click/focus should be native and inspectable.
- Expected MVP scale is hundreds to low thousands of semantic blocks, where SVG is still practical.
- SVG keeps accessibility and export paths simple.

Canvas remains a future optimization for zoomed-out/high-volume overviews if traces reach tens of thousands of visible glyphs. Architecture keeps semantic blocks separate from renderer so a hybrid SVG/Canvas renderer can be added later.

## Local development

Run collector/backend and Vite frontend separately:

```bash
bun --filter acp-observatory serve --host 0.0.0.0 --port 4173
bun --filter acp-observatory dev --host 127.0.0.1 --port 5173
```

Vite proxies `/api/*` to the collector at `http://127.0.0.1:4173`.

## Start a VM review and watch it live

Use `review-watch` to submit a pi-worker review job, start the NDJSON sender in the VM, and print the frontend URL.

1. Start collector and frontend:

```bash
bun --filter acp-observatory serve --host 0.0.0.0 --port 4173
bun --filter acp-observatory dev --host 127.0.0.1 --port 5173
```

2. Submit review + attach sender:

```bash
bun --filter acp-observatory review-watch --name acp-observatory-review
```

The command prints:

```json
{
  "jobId": "...",
  "streamId": "pi-worker/.../pi",
  "url": "http://127.0.0.1:5173/?stream=pi-worker%2F...%2Fpi"
}
```

Open `url` to watch the review.

Custom prompt:

```bash
cat > /tmp/acp-observatory-review-prompt.txt <<'PROMPT'
Review packages/acp-observatory. Do not edit files. Focus on projection, layout, SSE, tests, and architecture. Return prioritized P0/P1/P2 findings.
PROMPT

bun --filter acp-observatory review-watch \
  --name acp-observatory-review-layout \
  --prompt-file /tmp/acp-observatory-review-prompt.txt
```

Useful checks:

```bash
# VM sender logs
orbctl run -m pi-worker bash -lc 'tmux capture-pane -pt acp-observatory-sender:0 -S -30'

# Job status
orbctl run -m pi-worker bash -lc 'jq "{id,status,startedAt,completedAt,error}" ~/.pi-worker/telegram/jobs/<jobId>.json'

# Collector snapshot
curl -fsS 'http://127.0.0.1:4173/api/streams/<url-encoded-stream-id>/snapshot?limit=5'
```

Notes:

- `review-watch` assumes the repo is synced into OrbStack VM `pi-worker` at `/home/piagent/workspaces/theo-pi`.
- Sender posts to `http://host.orb.internal:4173/api/ingest` from inside the VM.
- Collector currently stores traces in memory only; restart loses streams unless sender replays the NDJSON file.

## Graphite stack strategy for review

The observatory work currently sits on a long Graphite stack. Best practice for review:

1. Keep the **new product** branches (`acp-observatory-*`) as the primary review stack.
2. Treat old `acp-block-watch-*` branches as prototype history. Do not ask reviewers to evaluate them as product direction unless needed for context.
3. Submit the stack with a clear PR series:
   - scaffold package and core protocol
   - real streaming collector/sender
   - worker format compatibility
   - projection/grouping
   - layout experiments/final chronological layout
4. Use `gt submit --stack` from the top branch when ready.
5. If stack is too noisy, create a follow-up cleanup stack that deletes/sunsets `acp-block-watch` after observatory review lands.

Recommended pre-submit checks:

```bash
gt ls
bun --filter acp-observatory test
bun --filter acp-observatory check:ts
bun --filter acp-observatory build
gt submit --stack
```
