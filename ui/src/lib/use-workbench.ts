import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  SiteStatusRpc,
  HealthSnapshotRpc,
  ReconcileResultRpc,
  ReconcileEventRpc,
  HealthChangeEventRpc,
  LogLine,
} from "@smp/factory-shared/effect/workbench-rpc"
import { useWorkbenchConnection } from "./workbench-rpc"

export function useSiteStatus() {
  const wb = useWorkbenchConnection()
  return useQuery({
    queryKey: ["workbench", "SiteStatus"],
    queryFn: () => wb!.call((c) => c.SiteStatus()),
    enabled: !!wb && wb.status !== "error",
    refetchInterval: 5000,
  })
}

export function useSiteHealth() {
  const wb = useWorkbenchConnection()
  return useQuery({
    queryKey: ["workbench", "SiteHealth"],
    queryFn: () => wb!.call((c) => c.SiteHealth()),
    enabled: !!wb && wb.status !== "error",
    refetchInterval: 5000,
  })
}

export function useSiteReconcile() {
  const wb = useWorkbenchConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => wb!.call((c) => c.SiteReconcile()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workbench", "SiteStatus"] })
      queryClient.invalidateQueries({ queryKey: ["workbench", "SiteHealth"] })
    },
  })
}

export function useServiceRestart() {
  const wb = useWorkbenchConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => wb!.call((c) => c.ServiceRestart({ name })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workbench", "SiteStatus"] })
    },
  })
}

export function useSiteEvents() {
  const wb = useWorkbenchConnection()
  const [events, setEvents] = useState<ReconcileEventRpc[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!wb || wb.status === "error") return

    cleanupRef.current = wb.subscribe(
      (c) => c.SiteEvents(),
      (event) => setEvents((prev) => [...prev.slice(-199), event]),
      undefined,
      () => {}
    )

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [wb])

  return { events, latest: events[events.length - 1] ?? null }
}

export function useHealthChanges() {
  const wb = useWorkbenchConnection()
  const [snapshots, setSnapshots] = useState<HealthChangeEventRpc[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!wb || wb.status === "error") return

    cleanupRef.current = wb.subscribe(
      (c) => c.HealthChanges(),
      (snapshot) => setSnapshots((prev) => [...prev.slice(-49), snapshot]),
      undefined,
      () => {}
    )

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [wb])

  return { snapshots, latest: snapshots[snapshots.length - 1] ?? null }
}

export function useServiceLogs(name: string, opts?: { tail?: number }) {
  const wb = useWorkbenchConnection()
  const [lines, setLines] = useState<string[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!wb || wb.status === "error" || !name) return

    setLines([])

    cleanupRef.current = wb.subscribe(
      (c) => c.ServiceLogs({ name, tail: opts?.tail ?? 200 }),
      (logLine) => setLines((prev) => [...prev.slice(-999), logLine.line]),
      undefined,
      () => {}
    )

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [wb, name, opts?.tail])

  return { lines, latest: lines[lines.length - 1] ?? null }
}

export function useReadDir(root = ".") {
  const wb = useWorkbenchConnection()
  const [paths, setPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!wb || wb.status === "error") {
      setLoading(false)
      return
    }

    setPaths([])
    setLoading(true)

    cleanupRef.current = wb.subscribe(
      (c) => c.ReadDir({ root }),
      (item) => setPaths((prev) => [...prev, item.path]),
      undefined,
      () => setLoading(false)
    )

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [wb, root])

  return { paths, loading }
}

export function useReadFile() {
  const wb = useWorkbenchConnection()

  return useMutation({
    mutationFn: (path: string) => wb!.call((c) => c.ReadFile({ path })),
  })
}
