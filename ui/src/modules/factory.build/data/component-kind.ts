export const COMPONENT_KIND_COLOR: Record<string, string> = {
  service: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  worker: "border-cyan-400 bg-cyan-50 dark:bg-cyan-950/30",
  task: "border-orange-400 bg-orange-50 dark:bg-orange-950/30",
  cronjob: "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30",
  website: "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
  library: "border-pink-400 bg-pink-50 dark:bg-pink-950/30",
  cli: "border-zinc-400 bg-zinc-50 dark:bg-zinc-950/30",
  agent: "border-violet-400 bg-violet-50 dark:bg-violet-950/30",
  gateway: "border-teal-400 bg-teal-50 dark:bg-teal-950/30",
  proxy: "border-teal-400 bg-teal-50 dark:bg-teal-950/30",
  database: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  cache: "border-red-400 bg-red-50 dark:bg-red-950/30",
  queue: "border-purple-400 bg-purple-50 dark:bg-purple-950/30",
  storage: "border-stone-400 bg-stone-50 dark:bg-stone-950/30",
  search: "border-sky-400 bg-sky-50 dark:bg-sky-950/30",
  init: "border-orange-400 bg-orange-50 dark:bg-orange-950/30",
}

export const COMPONENT_KIND_ICON: Record<string, string> = {
  service: "icon-[ph--gear-six-duotone]",
  worker: "icon-[ph--cpu-duotone]",
  task: "icon-[ph--play-circle-duotone]",
  cronjob: "icon-[ph--clock-clockwise-duotone]",
  website: "icon-[ph--browser-duotone]",
  library: "icon-[ph--book-open-duotone]",
  cli: "icon-[ph--terminal-duotone]",
  agent: "icon-[ph--brain-duotone]",
  gateway: "icon-[ph--arrows-split-duotone]",
  proxy: "icon-[ph--arrows-split-duotone]",
  database: "icon-[ph--database-duotone]",
  cache: "icon-[ph--lightning-duotone]",
  queue: "icon-[ph--queue-duotone]",
  storage: "icon-[ph--archive-box-duotone]",
  search: "icon-[ph--magnifying-glass-duotone]",
  init: "icon-[ph--play-circle-duotone]",
}

export const COMPONENT_KIND_DOT: Record<string, string> = {
  service: "#60a5fa",
  worker: "#22d3ee",
  task: "#fb923c",
  cronjob: "#facc15",
  website: "#34d399",
  library: "#f472b6",
  cli: "#a1a1aa",
  agent: "#a78bfa",
  gateway: "#2dd4bf",
  proxy: "#2dd4bf",
  database: "#fbbf24",
  cache: "#f87171",
  queue: "#c084fc",
  storage: "#a8a29e",
  search: "#38bdf8",
  init: "#fb923c",
}

const INFER_RULES: [RegExp, string][] = [
  [/^traefik|^nginx|^caddy|^envoy|^haproxy|gateway/i, "gateway"],
  [/postgres|mysql|mariadb|mongo|cockroach|^db[-_]|^sql/i, "database"],
  [/redis|memcache|valkey|dragonfly/i, "cache"],
  [/kafka|rabbitmq|nats|pulsar|^queue|^mq/i, "queue"],
  [/minio|s3|gcs|^storage|^bucket/i, "storage"],
  [/elasticsearch|opensearch|typesense|meilisearch|solr|^search/i, "search"],
  [/pgbouncer|pgpool|proxysql|proxy/i, "proxy"],
  [/spicedb|auth[-_]service|keycloak|^auth/i, "service"],
  [/pgadmin|grafana|superset|kibana|admin/i, "service"],
  [/migrate|init|setup|seed/i, "init"],
  [/cron|scheduler|periodic/i, "cronjob"],
  [/worker|consumer|processor/i, "worker"],
  [/agent|bot|assistant/i, "agent"],
  [/app$|web$|frontend|ui$|marketing/i, "website"],
  [/cli$|^dx[-_]/i, "cli"],
  [/tiler|tileserv|martin/i, "service"],
]

export function inferComponentKind(c: any): string {
  const specType = c.spec?.type
  if (
    specType &&
    specType !== "infrastructure" &&
    specType !== "component" &&
    specType !== "init"
  ) {
    return specType
  }

  const name = (c.name ?? c.slug ?? "").toLowerCase()
  const image = (c.spec?.image ?? "").toLowerCase()
  const haystack = `${name} ${image}`

  for (const [pattern, kind] of INFER_RULES) {
    if (pattern.test(haystack)) return kind
  }

  if (specType === "infrastructure") return "service"
  if (specType === "init") return "task"
  return "service"
}

export function componentKindIcon(c: any): string {
  return COMPONENT_KIND_ICON[inferComponentKind(c)] ?? "icon-[ph--cube-duotone]"
}

export function componentKindColor(c: any): string {
  return (
    COMPONENT_KIND_COLOR[inferComponentKind(c)] ?? "border-zinc-300 bg-card"
  )
}
