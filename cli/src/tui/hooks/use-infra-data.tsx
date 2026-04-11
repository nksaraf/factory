import { getFactoryClient } from "../../client.js"
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

export function useWorkspaces() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.fleet.workspaces.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useHosts() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.hosts.get()
      return unwrap(res)
    },
    [],
    { interval: 15000 }
  )
}

export function usePreviews() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.fleet.previews.get()
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
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra["dns-domains"].get({
        query: {},
      })
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}
