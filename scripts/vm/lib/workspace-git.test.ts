import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { syncWorkspaceToOrigin, workspaceGitSyncEnabled } from "./workspace-git"

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

async function makeOriginAndClone() {
  const root = await mkdtemp(join(tmpdir(), "workspace-git-"))
  const origin = join(root, "origin")
  const clone = join(root, "clone")
  execFileSync("git", ["init", "--initial-branch=main", origin])
  git(origin, "config", "user.email", "test@test")
  git(origin, "config", "user.name", "test")
  await writeFile(join(origin, "file.txt"), "v1\n")
  git(origin, "add", ".")
  git(origin, "commit", "-m", "v1")
  execFileSync("git", ["clone", origin, clone], { encoding: "utf8" })
  return { origin, clone }
}

test("sync resets clone to latest origin commit", async () => {
  const { origin, clone } = await makeOriginAndClone()
  await writeFile(join(origin, "file.txt"), "v2\n")
  git(origin, "commit", "-am", "v2")
  // Local drift that must be discarded on reset.
  await writeFile(join(clone, "file.txt"), "local edit\n")

  const result = await syncWorkspaceToOrigin(clone, {})
  expect(result.status).toBe("synced")
  expect(result.detail).toContain("origin/main")
  expect(git(clone, "log", "-1", "--format=%s")).toBe("v2")
  expect(await Bun.file(join(clone, "file.txt")).text()).toBe("v2\n")
})

test("sync keeps untracked files (runtime overlay)", async () => {
  const { clone } = await makeOriginAndClone()
  await writeFile(join(clone, "untracked.env"), "keep me\n")

  const result = await syncWorkspaceToOrigin(clone, {})
  expect(result.status).toBe("synced")
  expect(await Bun.file(join(clone, "untracked.env")).text()).toBe("keep me\n")
})

test("sync skips non-git directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "workspace-git-plain-"))
  const result = await syncWorkspaceToOrigin(dir, {})
  expect(result.status).toBe("skipped")
})

test("sync skips when no cwd configured", async () => {
  const result = await syncWorkspaceToOrigin(undefined, {})
  expect(result.status).toBe("skipped")
})

test("sync can be disabled via env", async () => {
  const { clone } = await makeOriginAndClone()
  const result = await syncWorkspaceToOrigin(clone, { PI_WORKER_RESET_GIT_SYNC: "0" })
  expect(result.status).toBe("skipped")
  expect(workspaceGitSyncEnabled({ PI_WORKER_RESET_GIT_SYNC: "0" })).toBe(false)
  expect(workspaceGitSyncEnabled({})).toBe(true)
})

test("sync honors PI_WORKER_GIT_REF branch override", async () => {
  const { origin, clone } = await makeOriginAndClone()
  git(origin, "checkout", "-b", "release")
  await writeFile(join(origin, "file.txt"), "release\n")
  git(origin, "commit", "-am", "release commit")

  const result = await syncWorkspaceToOrigin(clone, { PI_WORKER_GIT_REF: "release" })
  expect(result.status).toBe("synced")
  expect(await Bun.file(join(clone, "file.txt")).text()).toBe("release\n")
})
