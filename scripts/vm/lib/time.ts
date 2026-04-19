export function nowIso() {
  return new Date().toISOString()
}

export function parseIsoToMillis(value: string | null | undefined) {
  if (!value) return null
  const millis = Date.parse(value)
  return Number.isFinite(millis) ? millis : null
}

export function isOlderThan(value: string | null | undefined, now: string, ageSeconds: number) {
  const at = parseIsoToMillis(value)
  const nowMillis = parseIsoToMillis(now)
  if (at === null || nowMillis === null) return false
  return nowMillis - at > ageSeconds * 1000
}
