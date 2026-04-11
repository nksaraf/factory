import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  proxmox: { icon: "icon-[ph--cube-duotone]", color: "text-orange-400" },
  hetzner: { icon: "icon-[ph--cloud-duotone]", color: "text-red-400" },
  aws: { icon: "icon-[ph--cloud-duotone]", color: "text-amber-400" },
  gcp: { icon: "icon-[ph--cloud-duotone]", color: "text-blue-400" },
}

export function ProviderTypeIcon({
  type,
  className,
}: {
  type: string
  className?: string
}) {
  const config = PROVIDER_ICONS[type] ?? {
    icon: "icon-[ph--cloud-duotone]",
    color: "text-zinc-400",
  }
  return (
    <Icon
      icon={config.icon}
      className={cn("h-5 w-5", config.color, className)}
    />
  )
}
