import { expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createAcpxEventLog } from "./acpx-event-log"

test("event seq continues from existing file after logger recreation", async () => {
  const root = await mkdtemp(join(tmpdir(), "acpx-event-log-"))
  try {
    const first = createAcpxEventLog(root)
    await first.append("job-1", "initial", { type: "text_delta", text: "a" })
    await first.append("job-1", "initial", { type: "text_delta", text: "b" })

    const second = createAcpxEventLog(root)
    await second.append("job-1", "retry", { type: "text_delta", text: "c" })

    const lines = (await readFile(first.eventPath("job-1"), "utf8")).trim().split("\n")
    expect(lines.map((line) => JSON.parse(line).seq)).toEqual([1, 2, 3])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
