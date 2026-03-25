import type { ProviderType } from "@smp/factory-shared/types";
import type { ObservabilityBackendType } from "@smp/factory-shared/observability-types";
import type { Database } from "../db/connection";
import type { ProviderAdapter } from "./provider-adapter";
import type { ObservabilityAdapter } from "./observability-adapter";
import type { WorkTrackerAdapter } from "./work-tracker-adapter";
import type { GitHostAdapter } from "./git-host-adapter";
import { ProxmoxAdapter } from "./proxmox.adapter";
import { NoopGitHostAdapter } from "./git-host-adapter-noop";
import { GitHubAdapter } from "./git-host-adapter-github";
import { NoopObservabilityAdapter } from "./observability-adapter-noop";
import { NoopWorkTrackerAdapter } from "./work-tracker-adapter-noop";
import { JiraWorkTrackerAdapter } from "./work-tracker-adapter-jira";
import { LinearWorkTrackerAdapter } from "./work-tracker-adapter-linear";

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

const workTrackerAdapters: Record<string, () => WorkTrackerAdapter> = {
  noop: () => new NoopWorkTrackerAdapter(),
  jira: () => new JiraWorkTrackerAdapter(),
  linear: () => new LinearWorkTrackerAdapter(),
};

export function getWorkTrackerAdapter(
  type: string = "noop"
): WorkTrackerAdapter {
  const factory = workTrackerAdapters[type];
  if (!factory) {
    throw new Error(
      `No work tracker adapter for type: ${type}. Supported: ${Object.keys(workTrackerAdapters).join(", ")}`
    );
  }
  return factory();
}

export interface GitHostAdapterConfig {
  token?: string;
  apiBaseUrl?: string;
  webhookSecret?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
}

export function createGitHostAdapter(
  type: string,
  _config: GitHostAdapterConfig = {},
): GitHostAdapter {
  if (type === "github") return new GitHubAdapter(config);
  if (type === "noop") return new NoopGitHostAdapter();
  throw new Error(
    `No git host adapter for type: ${type}. Supported: github, noop`,
  );
}
