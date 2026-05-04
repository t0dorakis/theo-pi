#!/usr/bin/env bun
import * as acp from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"

import { TheoPiAcpAgent } from "./lib/theo-pi-acp-agent"

const gatewayUrl = process.env.THEO_PI_GATEWAY_URL ?? process.env.PI_WORKER_GATEWAY_URL ?? "http://127.0.0.1:8787"
const gatewayToken = process.env.THEO_PI_GATEWAY_TOKEN ?? process.env.PI_WORKER_GATEWAY_TOKEN ?? ""

if (!gatewayToken) {
  console.error("Missing THEO_PI_GATEWAY_TOKEN or PI_WORKER_GATEWAY_TOKEN")
  process.exit(1)
}

const input = Writable.toWeb(process.stdout)
const output = Readable.toWeb(process.stdin)
const stream = acp.ndJsonStream(input, output as unknown as ReadableStream<Uint8Array>)
new acp.AgentSideConnection((connection) => new TheoPiAcpAgent(connection, { gatewayUrl, gatewayToken }), stream)
