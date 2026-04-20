import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { api } from "../api-client.js"

export function useTunnelStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (exposeConsole: boolean) => api.startTunnel(exposeConsole),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  })
}

export function useTunnelStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.stopTunnel(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  })
}

export function useWhoami() {
  return useQuery({
    queryKey: ["whoami"],
    queryFn: api.whoami,
    refetchInterval: 15_000,
  })
}

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: api.session,
    refetchInterval: 5000,
  })
}

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: api.services,
    refetchInterval: 2000,
  })
}

export function useService(name: string) {
  return useQuery({
    queryKey: ["service", name],
    queryFn: () => api.service(name),
    refetchInterval: 2000,
  })
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  })
}

export function useEnv() {
  return useQuery({
    queryKey: ["env"],
    queryFn: api.env,
    refetchInterval: 5000,
  })
}

export function useLocation() {
  return useQuery({
    queryKey: ["location"],
    queryFn: api.location,
  })
}

export function usePorts() {
  return useQuery({
    queryKey: ["ports"],
    queryFn: api.ports,
    refetchInterval: 5000,
  })
}

export function useThreadChannels() {
  return useQuery({
    queryKey: ["thread-channels"],
    queryFn: api.threadChannels,
    refetchInterval: 10_000,
  })
}

export function useChannelThreads(channelId: string | null | undefined) {
  return useQuery({
    queryKey: ["channel-threads", channelId],
    queryFn: () => api.channelThreads(channelId!),
    enabled: !!channelId,
    refetchInterval: 5000,
  })
}

export function useThread(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => api.thread(threadId!),
    enabled: !!threadId,
    refetchInterval: 5000,
  })
}

export function useThreadTurns(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread-turns", threadId],
    queryFn: () => api.threadTurns(threadId!),
    enabled: !!threadId,
    refetchInterval: 3000,
  })
}

export function useThreadPlans(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread-plans", threadId],
    queryFn: () => api.threadPlans(threadId!),
    enabled: !!threadId,
    refetchInterval: 15_000,
  })
}

export function usePlanContent(slug: string | null | undefined) {
  return useQuery({
    queryKey: ["plan-content", slug],
    queryFn: () => api.planContent(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function usePlanVersions(slug: string | null | undefined) {
  return useQuery({
    queryKey: ["plan-versions", slug],
    queryFn: () => api.planVersions(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

const MAX_LOG_LINES = 500

export function useLogStream(name: string) {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    setLines([])
    const es = new EventSource(
      `/api/dev/services/${encodeURIComponent(name)}/logs/stream`
    )
    es.onmessage = (ev) => {
      try {
        const line = JSON.parse(ev.data) as string
        setLines((prev) => {
          const next = [...prev, line]
          return next.length > MAX_LOG_LINES
            ? next.slice(next.length - MAX_LOG_LINES)
            : next
        })
      } catch {
        // ignore malformed
      }
    }
    es.onerror = () => {
      // let EventSource auto-reconnect
    }
    return () => es.close()
  }, [name])

  return lines
}
