import { useQuery } from "@tanstack/react-query"
import { orgApi } from "./api"

export function usePrincipals() {
  return useQuery({
    queryKey: ["org", "principals"],
    queryFn: orgApi.principals,
    refetchInterval: 30_000,
  })
}
export function usePrincipal(slug: string | undefined) {
  return useQuery({
    queryKey: ["org", "principal", slug],
    queryFn: () => orgApi.principal(slug!),
    enabled: !!slug,
  })
}
export function usePrincipalLinks(slug: string | undefined) {
  return useQuery({
    queryKey: ["org", "principal-links", slug],
    queryFn: () => orgApi.principalLinks(slug!),
    enabled: !!slug,
  })
}
export function useTeams() {
  return useQuery({
    queryKey: ["org", "teams"],
    queryFn: orgApi.teams,
    refetchInterval: 30_000,
  })
}
export function useTeam(slug: string | undefined) {
  return useQuery({
    queryKey: ["org", "team", slug],
    queryFn: () => orgApi.team(slug!),
    enabled: !!slug,
  })
}
export function useTeamMembers(slug: string | undefined) {
  return useQuery({
    queryKey: ["org", "team-members", slug],
    queryFn: () => orgApi.teamMembers(slug!),
    enabled: !!slug,
  })
}
export function useSecrets() {
  return useQuery({
    queryKey: ["org", "secrets"],
    queryFn: orgApi.secrets,
    refetchInterval: 30_000,
  })
}
export function useRolePresets() {
  return useQuery({
    queryKey: ["org", "role-presets"],
    queryFn: orgApi.rolePresets,
    refetchInterval: 60_000,
  })
}
