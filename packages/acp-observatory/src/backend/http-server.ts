import { readFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"

import { Effect, Exit, Queue, Scope } from "effect"
import type { CloseableScope } from "effect/Scope"

import { makeTraceCollector, type TraceCollector } from "./collector"

type ServerOptions = {
  host?: string
  port?: number
  staticDir?: string
}

const encoder = new TextEncoder()

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function contentType(path: string) {
  const ext = extname(path)
  if (ext === ".html") return "text/html; charset=utf-8"
  if (ext === ".js") return "text/javascript; charset=utf-8"
  if (ext === ".css") return "text/css; charset=utf-8"
  if (ext === ".svg") return "image/svg+xml"
  return "application/octet-stream"
}

async function serveStatic(staticDir: string, pathname: string) {
  const normalized = pathname === "/" ? "/index.html" : pathname
  const filePath = resolve(join(staticDir, normalized))
  const root = resolve(staticDir)
  if (!filePath.startsWith(root)) return new Response("not found", { status: 404 })
  const file = Bun.file(filePath)
  if (!await file.exists()) return new Response("not found", { status: 404 })
  return new Response(file, { headers: { "content-type": contentType(filePath) } })
}

function parseNumberParam(url: URL, name: string) {
  const raw = url.searchParams.get(name)
  if (raw == null || raw.trim() === "") return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function startObservatoryServer(options: ServerOptions = {}) {
  const collector = await Effect.runPromise(makeTraceCollector())
  const host = options.host ?? "127.0.0.1"
  const port = options.port ?? 4173
  const staticDir = options.staticDir ?? resolve("dist/client")

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request, server) {
      const url = new URL(request.url)

      if (request.method === "POST" && url.pathname === "/api/ingest") {
        const body = await request.json().catch(() => null)
        if (Array.isArray(body)) {
          const events = []
          for (const item of body) events.push(await Effect.runPromise(collector.ingest(item)))
          return json({ ok: true, count: events.length })
        }
        const event = await Effect.runPromise(collector.ingest(body))
        return json({ ok: true, event })
      }

      if (request.method === "GET" && url.pathname === "/api/streams") {
        return json(await Effect.runPromise(collector.listStreams()))
      }

      const snapshotMatch = url.pathname.match(/^\/api\/streams\/(.+)\/snapshot$/)
      if (request.method === "GET" && snapshotMatch) {
        const streamId = decodeURIComponent(snapshotMatch[1])
        return json(await Effect.runPromise(collector.snapshot(streamId, {
          afterSeq: parseNumberParam(url, "afterSeq"),
          limit: parseNumberParam(url, "limit"),
        })))
      }

      const eventMatch = url.pathname.match(/^\/api\/streams\/(.+)\/events$/)
      if (request.method === "GET" && eventMatch) {
        server.timeout(request, 0)
        const streamId = decodeURIComponent(eventMatch[1])
        let scope: CloseableScope | undefined
        let closed = false
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
        const close = () => {
          if (closed) return
          closed = true
          request.signal.removeEventListener("abort", close)
          if (scope) void Effect.runPromise(Scope.close(scope, Exit.void))
          try { controllerRef?.close() } catch { /* already closed */ }
        }
        request.signal.addEventListener("abort", close)
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller
            void (async () => {
              try {
                controller.enqueue(sse("snapshot", await Effect.runPromise(collector.snapshot(streamId))))
                scope = await Effect.runPromise(Scope.make())
                const dequeue = await Effect.runPromise(Scope.extend(collector.subscribe(), scope))
                while (!closed) {
                  const event = await Effect.runPromise(Queue.take(dequeue))
                  if (!closed && event.streamId === streamId) controller.enqueue(sse("event", event))
                }
              } catch (error) {
                if (!closed) controller.error(error)
              }
            })()
          },
          cancel: close,
        })
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } })
      }

      if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true })
      if (request.method === "GET") return serveStatic(staticDir, url.pathname)
      return new Response("not found", { status: 404 })
    },
  })

  return {
    url: `http://${host}:${server.port}`,
    stop: () => server.stop(),
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : args[index + 1]
  }
  const server = await startObservatoryServer({
    host: value("--host"),
    port: value("--port") ? Number(value("--port")) : undefined,
    staticDir: value("--static-dir"),
  })
  console.log(`acp-observatory listening ${server.url}`)
}
