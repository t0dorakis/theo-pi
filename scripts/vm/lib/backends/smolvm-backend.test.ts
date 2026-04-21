import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { WorkerJob } from "../types"
import { createSmolVmBackend } from "./smolvm-backend"

function job(): WorkerJob {
  return {
    id: "job-123",
    chatId: "1",
    prompt: "say hi",
    status: "running",
    createdAt: "2026-04-20T10:00:00Z",
    startedAt: "2026-04-20T10:00:01Z",
    completedAt: null,
    answer: null,
    error: null,
    backend: "smolvm",
    resultFormat: "text",
  }
}

test("smolvm backend writes done result from guest execution", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "smolvm-backend-"))
  const authPath = join(stateDir, "auth.json")
  await writeFile(authPath, "{}")
  const calls: string[] = []
  const backend = createSmolVmBackend({
    session: "smol-spike",
    stateDir,
    runLocal: async (command, args = []) => {
      calls.push([command, ...args].join(" "))
      if (command === "smolvm" && args[0] === "list") {
        return JSON.stringify({
          ok: true,
          data: { vms: [{ name: "smol-spike", status: "running", ssh_port: 2200 }] },
        })
      }
      if (command === "ssh") {
        return "hello from guest"
      }
      return ""
    },
    smolvm: {
      backend: "qemu",
      memoryMib: 4096,
      diskSizeMib: 8192,
      guestWorkdir: "~/smolvm-theo-pi",
      guestPiDir: "~/.pi/agent",
      hostPiAuthPath: authPath,
      hostPiSettingsPath: "",
      guestProvider: "openai-codex",
      guestModel: "gpt-5.4",
      vmName: "smol-spike",
    },
  })

  await backend.submitPrompt(job())

  expect(await backend.readResult(job())).toBe("hello from guest")
  expect(calls.join("\n")).toContain("</dev/null")
})

test("smolvm backend health returns failure detail", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "smolvm-backend-"))
  const authPath = join(stateDir, "auth.json")
  await writeFile(authPath, "{}")
  const backend = createSmolVmBackend({
    session: "smol-spike",
    stateDir,
    runLocal: async () => {
      throw new Error("missing pi")
    },
    smolvm: {
      backend: "qemu",
      memoryMib: 4096,
      diskSizeMib: 8192,
      guestWorkdir: "~/smolvm-theo-pi",
      guestPiDir: "~/.pi/agent",
      hostPiAuthPath: authPath,
      hostPiSettingsPath: "",
      guestProvider: "openai-codex",
      guestModel: "gpt-5.4",
      vmName: "smol-spike",
    },
  })

  await expect(backend.sessionHealth()).resolves.toEqual({
    ok: false,
    detail: expect.stringContaining("missing pi"),
  })
})

test("smolvm backend writes failed result when guest command fails", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "smolvm-backend-"))
  const authPath = join(stateDir, "auth.json")
  await writeFile(authPath, "{}")
  const backend = createSmolVmBackend({
    session: "smol-spike",
    stateDir,
    runLocal: async (command, args = []) => {
      if (command === "smolvm" && args[0] === "list") {
        return JSON.stringify({
          ok: true,
          data: { vms: [{ name: "smol-spike", status: "running", ssh_port: 2200 }] },
        })
      }
      if (command === "ssh") {
        throw new Error("guest boom")
      }
      return ""
    },
    smolvm: {
      backend: "qemu",
      memoryMib: 4096,
      diskSizeMib: 8192,
      guestWorkdir: "~/smolvm-theo-pi",
      guestPiDir: "~/.pi/agent",
      hostPiAuthPath: authPath,
      hostPiSettingsPath: "",
      guestProvider: "openai-codex",
      guestModel: "gpt-5.4",
      vmName: "smol-spike",
    },
  })

  await backend.submitPrompt(job())

  await expect(backend.readResult(job())).rejects.toThrow("guest boom")
  const raw = await readFile(join(stateDir, "jobs", "results", "job-123.json"), "utf8")
  expect(raw).toContain('"status": "failed"')
})
