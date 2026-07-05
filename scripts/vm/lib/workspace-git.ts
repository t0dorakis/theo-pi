import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type WorkspaceGitSyncResult = {
  status: "synced" | "skipped" | "failed"
  detail: string
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: 120_000 })
  return stdout.trim()
}

async function defaultBranch(cwd: string) {
  // origin/HEAD is only set on clones that saw the remote's default branch; fall back to main.
  const ref = await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/main")
  return ref.replace(/^origin\//, "")
}

export function workspaceGitSyncEnabled(processEnv: NodeJS.ProcessEnv = process.env) {
  return processEnv.PI_WORKER_RESET_GIT_SYNC !== "0"
}

/**
 * Bring the workspace to the latest pushed state of its origin branch.
 * Hard-resets tracked files only — untracked files (runtime overlay, env
 * files) survive. Never throws; callers report the result to the human.
 */
export async function syncWorkspaceToOrigin(
  cwd: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<WorkspaceGitSyncResult> {
  if (!workspaceGitSyncEnabled(processEnv)) {
    return { status: "skipped", detail: "disabled via PI_WORKER_RESET_GIT_SYNC=0" }
  }
  if (!cwd) return { status: "skipped", detail: "no workspace cwd configured" }

  const isRepo = await git(cwd, ["rev-parse", "--git-dir"]).then(() => true, () => false)
  if (!isRepo) return { status: "skipped", detail: `not a git repository: ${cwd}` }

  try {
    const branch = processEnv.PI_WORKER_GIT_REF || (await defaultBranch(cwd))
    await git(cwd, ["fetch", "origin", branch])
    await git(cwd, ["reset", "--hard", `origin/${branch}`])
    const head = await git(cwd, ["log", "-1", "--format=%h %s"])
    return { status: "synced", detail: `origin/${branch} @ ${head}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: "failed", detail: message }
  }
}
