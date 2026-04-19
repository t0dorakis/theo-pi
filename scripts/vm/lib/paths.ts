import { join } from "node:path"

export type RuntimePaths = {
  scriptDir: string
  stateDir: string
  telegramDir: string
  telegramJobsDir: string
  jobsDir: string
  jobRequestsDir: string
  jobResultsDir: string
  jobLeasesDir: string
}

export function getScriptDir(importMetaUrl: string) {
  return new URL(".", importMetaUrl).pathname
}

export function getRuntimePaths(stateDir: string, importMetaUrl: string): RuntimePaths {
  const scriptDir = getScriptDir(importMetaUrl)
  const telegramDir = join(stateDir, "telegram")
  const jobsDir = join(stateDir, "jobs")

  return {
    scriptDir,
    stateDir,
    telegramDir,
    telegramJobsDir: join(telegramDir, "jobs"),
    jobsDir,
    jobRequestsDir: join(jobsDir, "requests"),
    jobResultsDir: join(jobsDir, "results"),
    jobLeasesDir: join(jobsDir, "leases"),
  }
}

export function localScript(scriptDir: string, name: string) {
  return `${scriptDir}${name}`
}
