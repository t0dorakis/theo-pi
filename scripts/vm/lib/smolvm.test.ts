import { expect, test } from "bun:test"

import { buildGuestPiCommand, createSmolVmManager, parseListPayload } from "./smolvm"

test("parseListPayload returns matching vm row", () => {
  const payload = JSON.stringify({
    ok: true,
    data: {
      vms: [
        { name: "other", status: "running", ssh_port: 2201 },
        { name: "smol-spike", status: "running", ssh_port: 2200 },
      ],
    },
  })

  expect(parseListPayload(payload, "smol-spike")).toEqual({
    name: "smol-spike",
    status: "running",
    sshPort: 2200,
  })
})

test("buildGuestPiCommand closes stdin", () => {
  const command = buildGuestPiCommand({
    workdir: "~/work/job-1",
    promptPath: "~/work/job-1/prompt.txt",
    provider: "openai-codex",
    model: "gpt-5.4",
  })

  expect(command).toContain("</dev/null")
  expect(command).toContain("cd ~/work/job-1")
  expect(command).toContain("pi --provider openai-codex --model gpt-5.4 -p \"$(cat ~/work/job-1/prompt.txt)\"")
})

test("ensureVm creates missing vm and can delete unhealthy vm", async () => {
  const calls: string[] = []
  const manager = createSmolVmManager({
    vmName: "smol-spike",
    backend: "qemu",
    memoryMib: 4096,
    diskSizeMib: 8192,
    guestWorkdir: "~/smolvm-theo-pi",
    guestPiDir: "~/.config/pi",
    hostPiAuthPath: "/tmp/auth.json",
    hostRun: async (command, args = []) => {
      calls.push([command, ...args].join(" "))
      if (command === "smolvm" && args[0] === "list") {
        return JSON.stringify({ ok: true, data: { vms: [] } })
      }
      return ""
    },
  })

  await manager.ensureVm()
  await manager.deleteVm()

  expect(calls[0]).toContain("smolvm list --json --all")
  expect(calls[1]).toContain("smolvm create --name smol-spike")
  expect(calls.at(-1)).toContain("smolvm delete smol-spike")
})

test("guest command uses ssh against localhost ssh port", async () => {
  const calls: string[] = []
  const manager = createSmolVmManager({
    vmName: "smol-spike",
    backend: "qemu",
    memoryMib: 4096,
    diskSizeMib: 8192,
    guestWorkdir: "~/smolvm-theo-pi",
    guestPiDir: "~/.config/pi",
    hostPiAuthPath: "/tmp/auth.json",
    hostRun: async (command, args = []) => {
      calls.push([command, ...args].join(" "))
      if (command === "smolvm" && args[0] === "list") {
        return JSON.stringify({
          ok: true,
          data: { vms: [{ name: "smol-spike", status: "running", ssh_port: 2200 }] },
        })
      }
      return "ok"
    },
  })

  await manager.runGuest("echo hi")

  expect(calls.at(-1)).toContain("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2200 root@127.0.0.1 bash -lc echo")
})
