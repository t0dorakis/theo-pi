import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

function argValue(args: string[], flag: string) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function run(command: string, options: { cwd?: string } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8")
      const err = Buffer.concat(stderr).toString("utf8")
      if (code === 0) resolve({ stdout: out, stderr: err })
      else reject(new Error(`command failed ${code}: ${command}\n${err}\n${out}`))
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const name = argValue(args, "--name") ?? "acp-observatory-review"
  const promptPath = argValue(args, "--prompt-file")
  const collector = argValue(args, "--collector") ?? "http://host.orb.internal:4173/api/ingest"
  const source = argValue(args, "--source") ?? "pi-worker"
  const agent = argValue(args, "--agent") ?? "pi"
  const vm = argValue(args, "--vm") ?? "pi-worker"
  const workspace = argValue(args, "--workspace") ?? "/home/piagent/workspaces/theo-pi"
  const host = argValue(args, "--host") ?? "127.0.0.1"
  const port = argValue(args, "--port") ?? "5173"

  const prompt = promptPath
    ? await readFile(promptPath, "utf8")
    : "Review the current acp-observatory implementation. Do not edit files. Run targeted tests/build. Return prioritized P0/P1/P2 findings and recommendations."

  const submit = [
    `source ~/.env.pi 2>/dev/null || true`,
    `export PATH=\"$HOME/bin:$HOME/.bun/bin:$PATH\"`,
    `cd ${shellQuote(workspace)}`,
    `job=$(bun scripts/vm/pi-worker-submit-job.ts ${shellQuote(name)} ${shellQuote(prompt)} | jq -r .id)`,
    `echo $job`,
    `nohup bash -lc ${shellQuote(`cd ${workspace}; source ~/.env.pi 2>/dev/null || true; export PATH="$HOME/bin:$HOME/.bun/bin:$PATH"; bun scripts/vm/pi-worker-run-job.ts $job`)} > ~/.pi-worker/jobs/runner-$job.log 2>&1 &`,
  ].join("; ")

  const { stdout } = await run(`orbctl run -m ${shellQuote(vm)} bash -lc ${shellQuote(submit)}`)
  const jobId = stdout.trim().split("\n").at(-1)?.trim()
  if (!jobId) throw new Error(`could not parse job id from: ${stdout}`)

  const sender = [
    `cd ${shellQuote(workspace)}`,
    `for i in {1..40}; do test -f ~/.pi-worker/jobs/events/${jobId}.ndjson && break; sleep 0.5; done`,
    `tmux kill-session -t acp-observatory-sender >/dev/null 2>&1 || true`,
    `tmux new-session -d -s acp-observatory-sender ${shellQuote(`bun packages/acp-observatory/src/backend/file-sender.ts --file ~/.pi-worker/jobs/events/${jobId}.ndjson --to ${collector} --source ${source} --run ${jobId} --agent ${agent}`)}`,
  ].join("; ")
  await run(`orbctl run -m ${shellQuote(vm)} bash -lc ${shellQuote(sender)}`)

  const streamId = `${source}/${jobId}/${agent}`
  const url = `http://${host}:${port}/?stream=${encodeURIComponent(streamId)}`
  console.log(JSON.stringify({ jobId, streamId, url }, null, 2))
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
