/**
 * Inventory file schema — YAML-based declarative entity catalog.
 *
 * An inventory file declares entities as a list of typed records,
 * each identified by a `kind` literal matching the entity's CRUD route
 * singular name (kebab-case). The scanner reconciles these against the
 * live database via the `/inventory/scan` endpoint.
 */
import { z } from "zod"

import {
  CreateEstateSchema,
  CreateHostSchema,
  CreateRealmSchema,
  CreateServiceSchema,
  CreateRouteSchema,
  CreateDnsDomainSchema,
  CreateNetworkLinkSchema,
  CreateIpAddressSchema,
  CreateSecretSchema,
  CreateTunnelSchema,
} from "./infra"

import {
  CreateSiteSchema,
  CreateWorkbenchSchema,
  CreateSystemDeploymentSchema,
  CreateComponentDeploymentSchema,
  CreateTenantSchema,
  CreateDatabaseSchema,
  CreateForwardedPortSchema,
  CreateDeploymentSetSchema,
  CreateRolloutSchema,
} from "./ops"

import {
  CreateSystemSchema,
  CreateComponentSchema,
  CreateApiSchema,
  CreateArtifactSchema,
  CreateReleaseSchema,
  CreateTemplateSchema,
  CreateProductSchema,
  CreateProductSystemSchema,
  CreateCapabilitySchema,
} from "./software"

import {
  CreateTeamSchema,
  CreatePrincipalSchema,
  CreateAgentSchema,
  CreateScopeSchema,
  CreateMessagingProviderSchema,
  CreateChannelSchema,
  CreateConfigVarSchema,
  CreateDocumentSchema,
  CreateThreadSchema,
  CreateEntityRelationshipSchema,
  CreateRolePresetSchema,
} from "./org"

import {
  CreateRepoSchema,
  CreateGitHostProviderSchema,
  CreateWorkTrackerProviderSchema,
  CreateWorkTrackerProjectSchema,
} from "./build"

import {
  CreateBillableMetricSchema,
  CreateCustomerSchema,
  CreateEntitlementBundleSchema,
  CreatePlanSchema,
  CreateSubscriptionItemSchema,
  CreateSubscriptionSchema,
} from "./commerce"

// ── arm() helper ──────────────────────────────────────────────
//
// Extends a Create schema with a `kind` literal and optional `id`,
// then calls .passthrough() to allow slug-ref fields like `estateSlug`.

const arm = <K extends string, S extends z.ZodRawShape>(
  kind: K,
  schema: z.ZodObject<S>
) =>
  schema
    .extend({ kind: z.literal(kind), id: z.string().optional() })
    .passthrough()

// ── Inventory entity discriminated union ──────────────────────

export const InventoryEntitySchema = z.discriminatedUnion("kind", [
  // infra
  arm("estate", CreateEstateSchema),
  arm("host", CreateHostSchema),
  arm("realm", CreateRealmSchema),
  arm("service", CreateServiceSchema),
  arm("route", CreateRouteSchema),
  arm("dns-domain", CreateDnsDomainSchema),
  arm("network-link", CreateNetworkLinkSchema),
  arm("ip-address", CreateIpAddressSchema),
  arm("secret", CreateSecretSchema),
  arm("tunnel", CreateTunnelSchema),

  // ops
  arm("site", CreateSiteSchema),
  arm("workbench", CreateWorkbenchSchema),
  arm("system-deployment", CreateSystemDeploymentSchema),
  arm("component-deployment", CreateComponentDeploymentSchema),
  arm("tenant", CreateTenantSchema),
  arm("database", CreateDatabaseSchema),
  arm("forwarded-port", CreateForwardedPortSchema),
  arm("deployment-set", CreateDeploymentSetSchema),
  arm("rollout", CreateRolloutSchema),

  // software
  arm("system", CreateSystemSchema),
  arm("component", CreateComponentSchema),
  arm("api", CreateApiSchema),
  arm("artifact", CreateArtifactSchema),
  arm("release", CreateReleaseSchema),
  arm("template", CreateTemplateSchema),
  arm("product", CreateProductSchema),
  arm("product-system", CreateProductSystemSchema),
  arm("capability", CreateCapabilitySchema),

  // org
  arm("team", CreateTeamSchema),
  arm("principal", CreatePrincipalSchema),
  arm("agent", CreateAgentSchema),
  arm("scope", CreateScopeSchema),
  arm("messaging-provider", CreateMessagingProviderSchema),
  arm("channel", CreateChannelSchema),
  arm("config-var", CreateConfigVarSchema),
  arm("document", CreateDocumentSchema),
  arm("thread", CreateThreadSchema),
  arm("entity-relationship", CreateEntityRelationshipSchema),
  arm("role-preset", CreateRolePresetSchema),

  // build
  arm("repo", CreateRepoSchema),
  arm("git-host-provider", CreateGitHostProviderSchema),
  arm("work-tracker-provider", CreateWorkTrackerProviderSchema),
  arm("work-tracker-project", CreateWorkTrackerProjectSchema),

  // commerce
  arm("customer", CreateCustomerSchema),
  arm("plan", CreatePlanSchema),
  arm("subscription", CreateSubscriptionSchema),
  arm("subscription-item", CreateSubscriptionItemSchema),
  arm("entitlement-bundle", CreateEntitlementBundleSchema),
  arm("billable-metric", CreateBillableMetricSchema),
])
export type InventoryEntity = z.infer<typeof InventoryEntitySchema>

// ── Inventory file ────────────────────────────────────────────

export const InventoryFileSchema = z.object({
  version: z.literal("1"),
  entities: z.array(InventoryEntitySchema),
})
export type InventoryFile = z.infer<typeof InventoryFileSchema>

// ── Scan request body ─────────────────────────────────────────

export const InventoryScanBodySchema = z.object({
  entities: z.array(InventoryEntitySchema),
  dryRun: z.boolean().default(false),
})
export type InventoryScanBody = z.infer<typeof InventoryScanBodySchema>

// ── Reconciliation summary ────────────────────────────────────

export const InventoryReconciliationSummarySchema = z.object({
  dryRun: z.boolean(),
  byKind: z.record(
    z.object({
      created: z.number(),
      updated: z.number(),
      unchanged: z.number(),
    })
  ),
  errors: z.array(
    z.object({
      kind: z.string(),
      slug: z.string(),
      error: z.string(),
    })
  ),
})
export type InventoryReconciliationSummary = z.infer<
  typeof InventoryReconciliationSummarySchema
>
