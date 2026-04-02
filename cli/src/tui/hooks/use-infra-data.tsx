import { getFactoryClient } from "../../client.js"
import { usePoll, unwrap } from "./use-poll.js"

export function useProviders() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.providers.get()
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function useClusters() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.clusters.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useSandboxes() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await (api as any).api.v1.factory.infra.sandboxes.get()
      return unwrap(res)
    },
    [],
    { interval: 5000 }
  )
}

export function useVMs() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await api.api.v1.factory.infra.vms.get()
      return unwrap(res)
    },
    [],
    { interval: 10000 }
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

export function useKubeNodes() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await (api as any).api.v1.factory.infra["kube-nodes"].get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}

export function usePreviews() {
  return usePoll(
    async () => {
      const api = await getFactoryClient()
      const res = await (api as any).api.v1.factory.infra.previews.get()
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
      const res = await api.api.v1.factory.infra.gateway.routes.get()
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
      const res = await api.api.v1.factory.infra.gateway.domains.get({ query: {} })
      return unwrap(res)
    },
    [],
    { interval: 10000 }
  )
}
