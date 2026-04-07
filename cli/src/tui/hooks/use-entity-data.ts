import { getFactoryRestClient } from "../../client.js"
import { usePoll } from "./use-poll.js"

export function useEntityData(
  module: string,
  entity: string,
  opts?: { enabled?: boolean }
) {
  return usePoll(
    async () => {
      const client = await getFactoryRestClient()
      const res = await client.listEntities(module, entity)
      return (res.data as Record<string, unknown>[]) ?? []
    },
    [module, entity],
    { interval: 10000, enabled: opts?.enabled ?? true }
  )
}

export async function createEntityRecord(
  module: string,
  entity: string,
  body: Record<string, unknown>
) {
  const client = await getFactoryRestClient()
  return client.createEntity(module, entity, body)
}

export async function updateEntityRecord(
  module: string,
  entity: string,
  slugOrId: string,
  body: Record<string, unknown>
) {
  const client = await getFactoryRestClient()
  return client.updateEntity(module, entity, slugOrId, body)
}
