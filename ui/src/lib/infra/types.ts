export interface Estate {
  id: string
  slug: string
  name: string
  type: string
  parentEstateId: string | null
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface Host {
  id: string
  slug: string
  name: string
  type: string
  estateId: string | null
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface Realm {
  id: string
  slug: string
  name: string
  type: string
  parentRealmId: string | null
  estateId: string | null
  workbenchId: string | null
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface Service {
  id: string
  slug: string
  name: string
  type: string
  estateId: string | null
  realmId: string | null
  systemDeploymentId: string | null
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface Route {
  id: string
  slug: string
  name: string
  type: string
  domain: string
  realmId: string | null
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface DnsDomain {
  id: string
  slug: string
  name: string
  type: string
  fqdn: string
  siteId: string | null
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Tunnel {
  id: string
  type: string
  routeId: string
  principalId: string
  subdomain: string
  phase: string
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface IpAddress {
  id: string
  address: string
  subnetId: string | null
  assignedToKind: string | null
  assignedToId: string | null
  spec: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Secret {
  id: string
  slug: string
  name: string
  spec: Record<string, unknown>
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}
