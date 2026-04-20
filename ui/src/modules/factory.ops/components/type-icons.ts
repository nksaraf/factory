export const SITE_TYPE_ICONS: Record<string, string> = {
  production: "icon-[ph--shield-check-duotone]",
  staging: "icon-[ph--flask-duotone]",
  preview: "icon-[ph--eye-duotone]",
  development: "icon-[ph--code-duotone]",
  sandbox: "icon-[ph--package-duotone]",
  demo: "icon-[ph--presentation-chart-duotone]",
  "feature-branch": "icon-[ph--git-branch-duotone]",
  qat: "icon-[ph--exam-duotone]",
  test: "icon-[ph--test-tube-duotone]",
}

export const SYSTEM_DEPLOYMENT_TYPE_ICONS: Record<string, string> = {
  production: "icon-[ph--rocket-launch-duotone]",
  staging: "icon-[ph--flask-duotone]",
  dev: "icon-[ph--code-duotone]",
  preview: "icon-[ph--eye-duotone]",
}

export const WORKBENCH_TYPE_ICONS: Record<string, string> = {
  worktree: "icon-[ph--tree-structure-duotone]",
  container: "icon-[ph--package-duotone]",
  vm: "icon-[ph--monitor-duotone]",
  "preview-build": "icon-[ph--eye-duotone]",
  "preview-dev": "icon-[ph--eye-duotone]",
  namespace: "icon-[ph--folder-simple-duotone]",
  pod: "icon-[ph--cube-duotone]",
  "bare-process": "icon-[ph--terminal-duotone]",
  function: "icon-[ph--lightning-duotone]",
  sandbox: "icon-[ph--package-duotone]",
  "edge-worker": "icon-[ph--cloud-duotone]",
  static: "icon-[ph--file-duotone]",
}

export const INTERVENTION_TYPE_ICONS: Record<string, string> = {
  restart: "icon-[ph--arrow-clockwise-duotone]",
  scale: "icon-[ph--arrows-out-duotone]",
  rollback: "icon-[ph--arrow-u-up-left-duotone]",
  manual: "icon-[ph--hand-duotone]",
}

export const DATABASE_ENGINE_ICONS: Record<string, string> = {
  postgres: "icon-[ph--database-duotone]",
  mysql: "icon-[ph--database-duotone]",
  redis: "icon-[ph--lightning-duotone]",
  mongodb: "icon-[ph--database-duotone]",
}

export function getOpsEntityIcon(entityKind: string, type: string): string {
  const maps: Record<string, Record<string, string>> = {
    site: SITE_TYPE_ICONS,
    "system-deployment": SYSTEM_DEPLOYMENT_TYPE_ICONS,
    workbench: WORKBENCH_TYPE_ICONS,
    intervention: INTERVENTION_TYPE_ICONS,
    database: DATABASE_ENGINE_ICONS,
  }
  return maps[entityKind]?.[type] ?? "icon-[ph--cube-duotone]"
}
