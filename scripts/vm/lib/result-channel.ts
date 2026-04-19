import { createStateStore } from "./state-store"

export type ResultStatus = "done" | "failed"

export function createResultChannel(stateDir: string) {
  const stateStore = createStateStore(stateDir)
  const resultPath = (id: string) => `file:${stateStore.paths.jobResultsDir}/${id}.json`

  return {
    resultPath,
    async writeRequest(input: { id: string; backendId: string; prompt: string; createdAt?: string; acceptedAt?: string | null; leaseOwner?: string | null; leaseExpiresAt?: string | null }) {
      const request = {
        id: input.id,
        backendId: input.backendId,
        createdAt: input.createdAt ?? new Date().toISOString(),
        acceptedAt: input.acceptedAt ?? null,
        leaseOwner: input.leaseOwner ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        resultChannel: resultPath(input.id),
        request: {
          prompt: input.prompt,
        },
      }
      await stateStore.writeJobRequest(request)
      return request
    },
    async writeResult(input: { id: string; backendId: string; status: ResultStatus; answer?: string | null; error?: string | null; completedAt: string }) {
      await stateStore.writeJobResult(input)
      return input
    },
    async writeRawResult(id: string, value: unknown) {
      await stateStore.writeRawJobResult(id, value)
    },
    async readResult(id: string) {
      const result = await stateStore.readJobResult(id)
      if (!result || typeof result.id !== "string" || typeof result.backendId !== "string" || typeof result.status !== "string" || typeof result.completedAt !== "string") {
        throw new Error("malformed result")
      }
      if (result.status !== "done" && result.status !== "failed") {
        throw new Error("malformed result")
      }
      return result
    },
  }
}
