export const ESTATE_TYPE_ICONS: Record<string, string> = {
  "cloud-account": "icon-[ph--cloud-duotone]",
  region: "icon-[ph--globe-hemisphere-west-duotone]",
  datacenter: "icon-[ph--warehouse-duotone]",
  vpc: "icon-[ph--shield-duotone]",
  subnet: "icon-[ph--share-network-duotone]",
  rack: "icon-[ph--stack-duotone]",
  "dns-zone": "icon-[ph--globe-simple-duotone]",
  wan: "icon-[ph--wifi-high-duotone]",
  cdn: "icon-[ph--lightning-duotone]",
  hypervisor: "icon-[ph--cube-duotone]",
}

export const HOST_TYPE_ICONS: Record<string, string> = {
  "bare-metal": "icon-[ph--desktop-tower-duotone]",
  vm: "icon-[ph--monitor-duotone]",
  lxc: "icon-[ph--package-duotone]",
  "cloud-instance": "icon-[ph--cloud-duotone]",
  "network-appliance": "icon-[ph--router-duotone]",
}

export const REALM_TYPE_ICONS: Record<string, string> = {
  "k8s-cluster": "icon-[ph--hexagon-duotone]",
  "k8s-namespace": "icon-[ph--folder-simple-duotone]",
  "docker-engine": "icon-[ph--package-duotone]",
  "compose-project": "icon-[ph--stack-simple-duotone]",
  systemd: "icon-[ph--gear-six-duotone]",
  process: "icon-[ph--terminal-duotone]",
  proxmox: "icon-[ph--cube-duotone]",
  kvm: "icon-[ph--monitor-duotone]",
  "reverse-proxy": "icon-[ph--arrows-split-duotone]",
  firewall: "icon-[ph--shield-check-duotone]",
  router: "icon-[ph--router-duotone]",
  "load-balancer": "icon-[ph--scales-duotone]",
  "vpn-gateway": "icon-[ph--lock-key-duotone]",
  "service-mesh": "icon-[ph--graph-duotone]",
}

export const SERVICE_TYPE_ICONS: Record<string, string> = {
  database: "icon-[ph--database-duotone]",
  cache: "icon-[ph--lightning-duotone]",
  "object-store": "icon-[ph--archive-box-duotone]",
  queue: "icon-[ph--queue-duotone]",
  search: "icon-[ph--magnifying-glass-duotone]",
  cdn: "icon-[ph--lightning-duotone]",
  "managed-k8s": "icon-[ph--hexagon-duotone]",
  "compute-platform": "icon-[ph--cpu-duotone]",
  llm: "icon-[ph--brain-duotone]",
  "auth-provider": "icon-[ph--key-duotone]",
  "ci-cd": "icon-[ph--arrows-clockwise-duotone]",
  "source-control": "icon-[ph--git-branch-duotone]",
  "issue-tracker": "icon-[ph--ticket-duotone]",
  messaging: "icon-[ph--chat-circle-duotone]",
  payment: "icon-[ph--credit-card-duotone]",
  monitoring: "icon-[ph--chart-line-duotone]",
  email: "icon-[ph--envelope-duotone]",
  "dns-provider": "icon-[ph--globe-simple-duotone]",
  analytics: "icon-[ph--chart-bar-duotone]",
}

export const ROUTE_TYPE_ICONS: Record<string, string> = {
  ingress: "icon-[ph--arrow-square-in-duotone]",
  workbench: "icon-[ph--desktop-tower-duotone]",
  preview: "icon-[ph--eye-duotone]",
  tunnel: "icon-[ph--arrows-in-line-vertical-duotone]",
  "custom-domain": "icon-[ph--globe-duotone]",
}

export const TUNNEL_PHASE_ICONS: Record<string, string> = {
  connecting: "icon-[ph--spinner-duotone]",
  connected: "icon-[ph--plugs-connected-duotone]",
  disconnected: "icon-[ph--plugs-duotone]",
  error: "icon-[ph--warning-circle-duotone]",
}

export const DNS_TYPE_ICONS: Record<string, string> = {
  primary: "icon-[ph--globe-simple-duotone]",
  alias: "icon-[ph--link-duotone]",
  custom: "icon-[ph--pencil-simple-duotone]",
  wildcard: "icon-[ph--asterisk-duotone]",
}

export function getEntityIcon(entityKind: string, type: string): string {
  const maps: Record<string, Record<string, string>> = {
    estate: ESTATE_TYPE_ICONS,
    host: HOST_TYPE_ICONS,
    realm: REALM_TYPE_ICONS,
    service: SERVICE_TYPE_ICONS,
    route: ROUTE_TYPE_ICONS,
    tunnel: TUNNEL_PHASE_ICONS,
    "dns-domain": DNS_TYPE_ICONS,
  }
  return maps[entityKind]?.[type] ?? "icon-[ph--cube-duotone]"
}
