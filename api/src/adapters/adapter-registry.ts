import type { ProviderType } from "@smp/factory-shared/types";
import type { ObservabilityBackendType } from "@smp/factory-shared/observability-types";
import type { Database } from "../db/connection";
import type { ProviderAdapter } from "./provider-adapter";
import type { ObservabilityAdapter } from "./observability-adapter";
import { ProxmoxAdapter } from "./proxmox.adapter";
import { NoopObservabilityAdapter } from "./observability-adapter-noop";

const adapters: Partial<Record<ProviderType, (db: Database) => ProviderAdapter>> = {
  proxmox: (db) => new ProxmoxAdapter(db),
};

export function getProviderAdapter(type: ProviderType, db: Database): ProviderAdapter {
  const factory = adapters[type];
  if (!factory) {
    throw new Error(
      `No adapter for provider type: ${type}. Supported: ${Object.keys(adapters).join(", ")}`
    );
  }
  return factory(db);
}

const observabilityAdapters: Partial<
  Record<ObservabilityBackendType, () => ObservabilityAdapter>
> = {
  noop: () => new NoopObservabilityAdapter(),
};

export function getObservabilityAdapter(
  type: ObservabilityBackendType = "noop"
): ObservabilityAdapter {
  const factory = observabilityAdapters[type];
  if (!factory) {
    throw new Error(
      `No observability adapter for type: ${type}. Supported: ${Object.keys(observabilityAdapters).join(", ")}`
    );
  }
  return factory();
}
