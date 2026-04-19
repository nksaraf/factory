/**
 * Factory-specific table bindings — maps each ontology entity kind to its
 * existing Drizzle table + slug/id columns + FK columns for parent links.
 */

import type { TableBindings } from "@smp/ontology/adapters/postgres/bindings"
import {
  estate,
  host,
  realm,
  service,
  route,
  dnsDomain,
  networkLink,
} from "../db/schema/infra"
import {
  system,
  component,
  softwareApi,
  template,
  product,
  capability,
} from "../db/schema/software"
import { team, principal, agent } from "../db/schema/org"
import { site, systemDeployment, workbench } from "../db/schema/ops"
import { repo, gitHostProvider } from "../db/schema/build"

export const FACTORY_BINDINGS = {
  // ── Org ───────────────────────────────────────────────────
  team: {
    table: team,
    slug: team.slug,
    id: team.id,
    fks: { parent: team.parentTeamId },
  },
  principal: {
    table: principal,
    slug: principal.slug,
    id: principal.id,
    fks: { primaryTeam: principal.primaryTeamId },
  },
  agent: {
    table: agent,
    slug: agent.slug,
    id: agent.id,
  },

  // ── Infra ─────────────────────────────────────────────────
  estate: {
    table: estate,
    slug: estate.slug,
    id: estate.id,
    fks: { parent: estate.parentEstateId },
  },
  host: {
    table: host,
    slug: host.slug,
    id: host.id,
    fks: { estate: host.estateId },
  },
  realm: {
    table: realm,
    slug: realm.slug,
    id: realm.id,
    fks: { estate: realm.estateId, parent: realm.parentRealmId },
  },
  service: {
    table: service,
    slug: service.slug,
    id: service.id,
    fks: { estate: service.estateId },
  },
  route: {
    table: route,
    slug: route.slug,
    id: route.id,
  },
  "dns-domain": {
    table: dnsDomain,
    slug: dnsDomain.slug,
    id: dnsDomain.id,
  },
  "network-link": {
    table: networkLink,
    slug: networkLink.slug,
    id: networkLink.id,
  },

  // ── Software ──────────────────────────────────────────────
  system: {
    table: system,
    slug: system.slug,
    id: system.id,
  },
  component: {
    table: component,
    slug: component.slug,
    id: component.id,
    fks: { system: component.systemId },
  },
  api: {
    table: softwareApi,
    slug: softwareApi.slug,
    id: softwareApi.id,
    fks: { system: softwareApi.systemId },
  },
  template: {
    table: template,
    slug: template.slug,
    id: template.id,
  },
  product: {
    table: product,
    slug: product.slug,
    id: product.id,
  },
  capability: {
    table: capability,
    slug: capability.slug,
    id: capability.id,
  },

  // ── Ops ───────────────────────────────────────────────────
  site: {
    table: site,
    slug: site.slug,
    id: site.id,
  },
  "system-deployment": {
    table: systemDeployment,
    slug: systemDeployment.slug,
    id: systemDeployment.id,
    fks: {
      site: systemDeployment.siteId,
      system: systemDeployment.systemId,
      realm: systemDeployment.realmId,
    },
  },
  workbench: {
    table: workbench,
    slug: workbench.slug,
    id: workbench.id,
    fks: {
      site: workbench.siteId,
      host: workbench.hostId,
      realm: workbench.realmId,
    },
  },

  // ── Build ─────────────────────────────────────────────────
  repository: {
    table: repo,
    slug: repo.slug,
    id: repo.id,
  },
  "git-host-provider": {
    table: gitHostProvider,
    slug: gitHostProvider.slug,
    id: gitHostProvider.id,
  },
} as const satisfies TableBindings
