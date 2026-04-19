import { nowIso } from "./time"

export function leaseExpiry(fromIso: string = nowIso(), leaseDurationSeconds: number) {
  return new Date(Date.parse(fromIso) + leaseDurationSeconds * 1000).toISOString()
}

export function leaseExpired(expiresAt: string | null | undefined, now: string = nowIso()) {
  if (!expiresAt) return false
  return Date.parse(expiresAt) <= Date.parse(now)
}
