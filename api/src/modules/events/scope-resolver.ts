export interface EventScope {
  scopeKind: string
  scopeId: string
}

export interface PrincipalContext {
  principalId: string
  scopes: Array<{ kind: string; id: string }>
  isAdmin?: boolean
}

const SEVERITY_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  critical: 3,
}

export function severityGte(severity: string, minSeverity: string): boolean {
  return (SEVERITY_ORDER[severity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0)
}

export function canPrincipalSeeEvent(
  eventScope: EventScope,
  principal: PrincipalContext
): boolean {
  const { scopeKind, scopeId } = eventScope

  switch (scopeKind) {
    case "org":
      return principal.scopes.some((s) => s.kind === "org" && s.id === scopeId)
    case "principal":
      return principal.principalId === scopeId
    case "system":
      return principal.isAdmin === true
    case "team":
    case "project":
    case "site":
      return principal.scopes.some(
        (s) => s.kind === scopeKind && s.id === scopeId
      )
    default:
      return principal.scopes.some((s) => s.kind === "org")
  }
}
