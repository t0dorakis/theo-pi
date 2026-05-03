// Per-key file lock for atomic check-and-create of ACP sessions.
// Uses O_EXCL atomic file creation — no race between concurrent first messages.

import { open, unlink, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"

/**
 * Acquire a per-key file lock in `lockDir`.
 *
 * Returns a release function. Always call the release function in a finally
 * block to clean up the lock file even when the critical section throws.
 *
 * Throws if the lock cannot be acquired within `timeoutMs` milliseconds.
 */
export async function acquireSessionLock(
  lockDir: string,
  key: string,
  timeoutMs = 5000,
): Promise<() => Promise<void>> {
  // Sanitize key for use as a filename.
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_")
  const lockPath = join(lockDir, "session-locks", `${safeKey}.lock`)

  await mkdir(dirname(lockPath), { recursive: true })

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      // O_EXCL = fail if file already exists — atomic creation.
      const handle = await open(lockPath, "wx")
      await handle.writeFile(String(process.pid))
      await handle.close()
      // Return the release function.
      return async () => {
        await unlink(lockPath).catch(() => {})
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      await new Promise<void>((r) => setTimeout(r, 50))
    }
  }

  throw new Error(`session lock timeout for key: ${key}`)
}
