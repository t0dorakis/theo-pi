#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { once } from "node:events"

const token = "smoke-token"
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }
    if (request.method === "POST" && url.pathname === "/run") {
      return Response.json({ ok: true, status: "queued", id: "job-1", chatId: "acp-smoke" })
    }
    if (request.method === "GET" && url.pathname === "/jobs/job-1/events") {
      const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10)
      const events = after < 1 ? [{ seq: 1, at: new Date().toISOString(), jobId: "job-1", attempt: "initial", event: { type: "text_delta", text: "Hello from worker", stream: "output" } }] : []
      return Response.json({ ok: true, jobId: "job-1", events })
    }
    if (request.method === "GET" && url.pathname === "/jobs/job-1") {
      return Response.json({ ok: true, job: { id: "job-1", chatId: "acp-smoke", prompt: "hello", status: "done", createdAt: new Date().toISOString(), startedAt: null, completedAt: new Date().toISOString(), answer: "Hello from worker", error: null, backend: "acpx", resultFormat: "text" } })
    }
    if (request.method === "POST" && url.pathname === "/jobs/job-1/cancel") {
      return Response.json({ ok: true, status: "cancel_requested", id: "job-1" })
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 })
  },
})

try {
  const child = spawn("./node_modules/.bin/acpx", ["--agent", "bun scripts/vm/pi-worker-acp-stdio.ts", "--timeout", "20", "--format", "quiet", "exec", "hello"], {
    env: {
      ...process.env,
      THEO_PI_GATEWAY_URL: `http://127.0.0.1:${server.port}`,
      THEO_PI_GATEWAY_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const [code] = await once(child, "close") as [number]
  if (code !== 0) throw new Error(`acpx exited ${code}\nstdout=${stdout}\nstderr=${stderr}`)
  if (!stdout.includes("Hello from worker")) throw new Error(`missing worker output\nstdout=${stdout}\nstderr=${stderr}`)
  console.log("[pass] acp stdio adapter smoke")
} finally {
  server.stop(true)
}
