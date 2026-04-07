// Legacy schemas (factory_* prefix)
export * from "./agent";
export * from "./build";
export * from "./catalog";
export * from "./commerce";
export * from "./fleet";
export * from "./gateway";
export * from "./infra";
export * from "./org";
export * from "./product";

// New ontology schemas (coexist during migration)
// Imported as namespaces to avoid name collisions with legacy tables.
// Usage: import { v2 } from "../db/schema"; v2.software.system, v2.org.team, etc.
export * from "./helpers";
export * as softwareV2 from "./software-v2";
export * as orgV2 from "./org-v2";
export * as infraV2 from "./infra-v2";
export * as opsV2 from "./ops";
export * as buildV2 from "./build-v2";
export * as commerceV2 from "./commerce-v2";
// workflow tables (workflowRun, eventSubscription) live in org-v2
