import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResultChannel } from "./result-channel"

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

test("request file written and result file discovered", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-result-"))
  tempDirs.push(root)
  const channel = createResultChannel(root)

  await channel.writeRequest({ id: "job-1", backendId: "tmux", prompt: "pong" })
  await channel.writeResult({ id: "job-1", backendId: "tmux", status: "done", answer: "pong", completedAt: "2026-04-16T10:00:00Z" })

  await expect(channel.readResult("job-1")).resolves.toMatchObject({ answer: "pong", status: "done" })
})

test("failed result preserves error text", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-result-"))
  tempDirs.push(root)
  const channel = createResultChannel(root)

  await channel.writeResult({ id: "job-1", backendId: "tmux", status: "failed", error: "missing or malformed <final_answer> block", completedAt: "2026-04-16T10:00:00Z" })
  await expect(channel.readResult("job-1")).resolves.toMatchObject({ status: "failed", error: "missing or malformed <final_answer> block" })
})

test("malformed result rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-worker-result-"))
  tempDirs.push(root)
  const channel = createResultChannel(root)

  await channel.writeRawResult("job-1", { nope: true })
  await expect(channel.readResult("job-1")).rejects.toThrow("malformed result")
})
