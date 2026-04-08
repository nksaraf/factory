import { getFactoryClient } from "../../client.js"
import { usePoll, unwrap } from "./use-poll.js"

export function useSites() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.fleet.sites.get()
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function useReleases() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.fleet.releases.get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 15000 }
  )
}

export function useModules() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.product.systems.get()
      return unwrap(res)
    },
    [],
    { interval: 15000 }
  )
}

export function useBuildRuns() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.build["pipeline-runs"].get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function useRepos() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.build.repos.get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 15000 }
  )
}

export function useCustomers() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.commerce.customers.get()
      return unwrap(res)
    },
    [],
    { interval: 30000 }
  )
}

export function useAlerts() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.observability.alerts.get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}
