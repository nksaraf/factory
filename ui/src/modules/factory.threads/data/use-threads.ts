import { useQuery } from "@tanstack/react-query"

import { threadsApi } from "./api"

export function useThreadChannels() {
  return useQuery({
    queryKey: ["thread-channels"],
    queryFn: threadsApi.channels,
    refetchInterval: 10_000,
  })
}

export function useChannelThreads(channelId: string | null | undefined) {
  return useQuery({
    queryKey: ["channel-threads", channelId],
    queryFn: () => threadsApi.channelThreads(channelId!),
    enabled: !!channelId,
    refetchInterval: 5000,
  })
}

export function useThread(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => threadsApi.thread(threadId!),
    enabled: !!threadId,
    refetchInterval: 5000,
  })
}

export function useThreadTurns(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread-turns", threadId],
    queryFn: () => threadsApi.threadTurns(threadId!),
    enabled: !!threadId,
    refetchInterval: 15_000,
  })
}

export function useThreadPlans(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ["thread-plans", threadId],
    queryFn: () => threadsApi.threadPlans(threadId!),
    enabled: !!threadId,
    refetchInterval: 15_000,
  })
}

export function usePlans(opts?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ["plans", opts?.limit ?? 500, opts?.offset ?? 0],
    queryFn: () => threadsApi.listPlans({ limit: opts?.limit ?? 500 }),
    refetchInterval: 30_000,
  })
}

export function usePlanSearch(q: string) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: ["plans-search", trimmed],
    queryFn: () => threadsApi.searchPlans(trimmed, 100),
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  })
}

export function usePlanContent(
  slug: string | null | undefined,
  version?: number | null
) {
  return useQuery({
    queryKey: ["plan-content", slug, version ?? "latest"],
    queryFn: () => threadsApi.planContent(slug!, version),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function usePlanVersions(slug: string | null | undefined) {
  return useQuery({
    queryKey: ["plan-versions", slug],
    queryFn: () => threadsApi.planVersions(slug!),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useThreadMessages(
  threadId: string | null | undefined,
  threadStatus?: string
) {
  const isActive = threadStatus === "active"
  return useQuery({
    queryKey: ["thread-messages", threadId],
    queryFn: () => threadsApi.threadMessages(threadId!),
    enabled: !!threadId,
    refetchInterval: isActive ? 2000 : 30_000,
  })
}

export function useThreadExchanges(
  threadId: string | null | undefined,
  threadStatus?: string
) {
  const isActive = threadStatus === "active"
  return useQuery({
    queryKey: ["thread-exchanges", threadId],
    queryFn: () => threadsApi.threadExchanges(threadId!),
    enabled: !!threadId,
    refetchInterval: isActive ? 5000 : 30_000,
  })
}
