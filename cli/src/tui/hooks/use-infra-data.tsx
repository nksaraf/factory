import { getFactoryClient, getFactoryRestClient } from "../../client.js"
import { unwrap, usePoll } from "./use-poll.js"

export function useEstates() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.estates.get()
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function useRealms() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.realms.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useWorkbenches() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.ops.workbenches.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useHosts() {
  return usePoll(
    async () => {
      const rest = await getFactoryRestClient()
      const res = await rest.listEntities("infra", "hosts")
      return res?.data ?? []
    },
    [],
    { interval: 15000 }
  )
}

export function usePreviews() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.ops.previews.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useRoutes() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.routes.get()
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function useDomains() {
  return usePoll(
    async () => {
      const rest = await getFactoryRestClient()
      const res = await rest.listEntities("infra", "dns-domains")
      return res?.data ?? []
    },
    [],
    { interval: 10000 }
  )
}
