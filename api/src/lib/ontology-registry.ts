/**
 * Ontology registry — single source of truth for all entity kinds.
 * Aggregates configs from all module controllers.
 * Used by the inventory reconciler for YAML-driven entity upserts.
 */
import type { OntologyRouteConfig } from "./crud"
import { infraOntologyConfigs } from "../modules/infra"
import { opsOntologyConfigs } from "../modules/ops"
import { buildOntologyConfigs } from "../modules/build"
import { commerceOntologyConfigs } from "../modules/commerce"
import { productOntologyConfigs } from "../modules/product"
import { identityOntologyConfigs } from "../modules/identity"
import { agentOntologyConfigs } from "../modules/agent"
import { threadsOntologyConfigs } from "../modules/threads"
import { documentsOntologyConfigs } from "../modules/documents"

type RegistryEntry = Pick<OntologyRouteConfig<any>, "entity" | "singular" | "table" | "slugColumn" | "idColumn" | "prefix" | "slugRefs" | "kindAlias" | "createSchema">

function singularize(entity: string): string {
  if (entity.endsWith("ies")) return entity.slice(0, -3) + "y"
  if (entity.endsWith("ses")) return entity.slice(0, -2)
  if (entity.endsWith("s")) return entity.slice(0, -1)
  return entity
}

const allConfigs: RegistryEntry[] = [
  ...infraOntologyConfigs,
  ...opsOntologyConfigs,
  ...buildOntologyConfigs,
  ...commerceOntologyConfigs,
  ...productOntologyConfigs,
  ...identityOntologyConfigs,
  ...agentOntologyConfigs,
  ...threadsOntologyConfigs,
  ...documentsOntologyConfigs,
]

// Key: YAML "kind" string (singular kebab-case) → entity config
export const ONTOLOGY_REGISTRY = new Map<string, RegistryEntry>(
  allConfigs.map((cfg) => [cfg.kindAlias ?? singularize(cfg.entity), cfg])
)
