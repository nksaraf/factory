export function StatusBadge({ status }: { status: string }) {
  const color =
    status === "running" || status === "healthy" || status === "connected"
      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
      : status === "starting" || status === "connecting"
        ? "bg-amber-500/10 text-amber-400 ring-amber-500/20"
        : status === "stopped" || status === "disconnected"
          ? "bg-zinc-500/10 text-zinc-400 ring-zinc-500/20"
          : "bg-red-500/10 text-red-400 ring-red-500/20"
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`}
    >
      {status}
    </span>
  )
}
