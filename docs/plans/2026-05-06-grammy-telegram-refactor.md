# grammY Telegram Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace raw Telegram polling/API code with grammY, runner, and throttler while preserving Pi worker queue execution.

**Architecture:** `pi-worker-telegram-bot.ts` becomes a grammY `Bot` with `@grammyjs/runner` long polling and mention/command middleware. `pi-worker-telegram-runner.ts` uses grammY `Api` for typing and final delivery. Pure routing helpers remain in `scripts/vm/lib/telegram-router.ts` for tests.

**Tech Stack:** Bun, TypeScript, grammY, @grammyjs/runner, @grammyjs/transformer-throttler, existing file-backed job queue.

---

### Task 1: Add dependencies

- Add `grammy`, `@grammyjs/runner`, `@grammyjs/transformer-throttler`.
- Run `npm install`.

### Task 2: Extract Telegram routing helper

- Create `scripts/vm/lib/telegram-router.ts`.
- Implement group detection, allowlist-independent routing, command normalization, mention stripping, and reply-to-bot activation.
- Rules:
  - private chat: plain text and slash commands work normally.
  - group prompt: requires `@bot` anywhere or reply to bot.
  - group command: `/status@bot` and `@bot /status` both work.
  - `@bot status` is a prompt, not command.

### Task 3: Refactor ingress bot to grammY

- Replace raw `getUpdates` loop in `scripts/vm/pi-worker-telegram-bot.ts`.
- Use `Bot`, `run`, and `apiThrottler`.
- Use router result to call existing command handlers or enqueue queue jobs.

### Task 4: Refactor outbound runner to grammY Api

- Replace `createTelegramApi` usage in `scripts/vm/pi-worker-telegram-runner.ts` with `Api` plus throttler.
- Keep queue claim/run/deliver semantics unchanged.

### Task 5: Remove old raw API/poller tests or adapt to router tests

- Delete obsolete `telegram-api.ts` / `telegram-poller.ts` if no references remain.
- Add tests for routing rules and negative group chat job delivery.

### Task 6: Verify and deploy

- Run targeted tests.
- Run `npm run check` and `npm run check:ts` if feasible.
- Sync changed files to `mama-pi`, restart bot, verify group mention and reply-to-bot behavior.
