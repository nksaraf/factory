import { useQuery } from "@tanstack/react-query"
import { buildApi } from "./api"

export function useRepos() {
  return useQuery({
    queryKey: ["build", "repos"],
    queryFn: buildApi.repos,
    refetchInterval: 30_000,
  })
}

export function useRepo(slug: string | undefined) {
  return useQuery({
    queryKey: ["build", "repo", slug],
    queryFn: () => buildApi.repo(slug!),
    enabled: !!slug,
  })
}

export function useSystems() {
  return useQuery({
    queryKey: ["build", "systems"],
    queryFn: buildApi.systems,
    refetchInterval: 30_000,
  })
}

export function useSystem(slug: string | undefined) {
  return useQuery({
    queryKey: ["build", "system", slug],
    queryFn: () => buildApi.system(slug!),
    enabled: !!slug,
  })
}

export function useComponents() {
  return useQuery({
    queryKey: ["build", "components"],
    queryFn: buildApi.components,
    refetchInterval: 30_000,
  })
}

export function useComponent(slug: string | undefined) {
  return useQuery({
    queryKey: ["build", "component", slug],
    queryFn: () => buildApi.component(slug!),
    enabled: !!slug,
  })
}

export function useSystemComponents(systemSlug: string | undefined) {
  return useQuery({
    queryKey: ["build", "system-components", systemSlug],
    queryFn: () => buildApi.systemComponents(systemSlug!),
    enabled: !!systemSlug,
  })
}
