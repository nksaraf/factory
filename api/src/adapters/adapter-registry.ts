import type { Database } from "../db/connection";
import type { VMProviderAdapter, VmProviderType } from "./vm-provider-adapter";
import type { ObservabilityAdapter, ObservabilityType } from "./observability-adapter";
import type { WorkTrackerAdapter, WorkTrackerType } from "./work-tracker-adapter";
import type { GitHostAdapter, GitHostAdapterConfig, GitHostType } from "./git-host-adapter";
import type { MessagingAdapter, MessagingType } from "./messaging-adapter";
import type { GatewayAdapter, GatewayType } from "./gateway-adapter";
import type { SandboxAdapter, SandboxType } from "./sandbox-adapter";
import type { NetworkDeviceAdapter, NetworkDeviceType, NetworkDeviceAdapterConfig } from "./network-device-adapter";
import type { IdentityProviderAdapter, IdentityProviderType } from "./identity-provider-adapter";
import { ProxmoxVmProviderAdapter } from "./vm-provider-adapter-proxmox";
import { NoopGitHostAdapter } from "./git-host-adapter-noop";
import { GitHubAdapter } from "./git-host-adapter-github";
import { NoopObservabilityAdapter } from "./observability-adapter-noop";
import { LokiObservabilityAdapter } from "./observability-adapter-loki";
import { NoopWorkTrackerAdapter } from "./work-tracker-adapter-noop";
import { JiraWorkTrackerAdapter } from "./work-tracker-adapter-jira";
import { LinearWorkTrackerAdapter } from "./work-tracker-adapter-linear";
import { NoopMessagingAdapter } from "./messaging-adapter-noop";
import { SlackMessagingAdapter } from "./messaging-adapter-slack";
import { NoopGatewayAdapter } from "./gateway-adapter-noop";
import { FileGatewayAdapter } from "./gateway-adapter-file";
import { NoopSandboxAdapter } from "./sandbox-adapter-noop";
import { NoopNetworkDeviceAdapter } from "./network-device-adapter-noop";
import { SnmpNetworkDeviceAdapter } from "./network-device-adapter-snmp";
import { GajShieldNetworkDeviceAdapter } from "./network-device-adapter-gajshield";
import { GitHubIdentityProviderAdapter } from "./identity-provider-adapter-github";
import { SlackIdentityProviderAdapter } from "./identity-provider-adapter-slack";
import { JiraIdentityProviderAdapter } from "./identity-provider-adapter-jira";
import { GoogleIdentityProviderAdapter } from "./identity-provider-adapter-google";

// ── VM Provider ──────────────────────────────────────────────

const vmProviderAdapters: Partial<Record<VmProviderType, (db: Database) => VMProviderAdapter>> = {
  proxmox: (db) => new ProxmoxVmProviderAdapter(db),
};

export function getVMProviderAdapter(type: VmProviderType, db: Database): VMProviderAdapter {
  const factory = vmProviderAdapters[type];
  if (!factory) {
    throw new Error(
      `No adapter for provider type: ${type}. Supported: ${Object.keys(vmProviderAdapters).join(", ")}`,
    );
  }
  return factory(db);
}

// ── Observability ────────────────────────────────────────────

const observabilityAdapters: Partial<Record<ObservabilityType, (opts?: { lokiUrl?: string }) => ObservabilityAdapter>> = {
  noop: () => new NoopObservabilityAdapter(),
  loki: (opts) => new LokiObservabilityAdapter(opts?.lokiUrl ?? "http://infra-loki:3100"),
};

export function getObservabilityAdapter(
  type: ObservabilityType = "noop",
  opts?: { lokiUrl?: string },
): ObservabilityAdapter {
  const factory = observabilityAdapters[type];
  if (!factory) {
    throw new Error(
      `No observability adapter for type: ${type}. Supported: ${Object.keys(observabilityAdapters).join(", ")}`,
    );
  }
  return factory(opts);
}

// ── Work Tracker ─────────────────────────────────────────────

const workTrackerAdapters: Record<WorkTrackerType, () => WorkTrackerAdapter> = {
  noop: () => new NoopWorkTrackerAdapter(),
  jira: () => new JiraWorkTrackerAdapter(),
  linear: () => new LinearWorkTrackerAdapter(),
};

export function getWorkTrackerAdapter(
  type: WorkTrackerType = "noop",
): WorkTrackerAdapter {
  const factory = workTrackerAdapters[type];
  if (!factory) {
    throw new Error(
      `No work tracker adapter for type: ${type}. Supported: ${Object.keys(workTrackerAdapters).join(", ")}`,
    );
  }
  return factory();
}

// ── Git Host ─────────────────────────────────────────────────

const gitHostAdapters: Partial<Record<GitHostType, (config: GitHostAdapterConfig) => GitHostAdapter>> = {
  github: (config) => new GitHubAdapter(config),
  noop: () => new NoopGitHostAdapter(),
};

export function getGitHostAdapter(
  type: GitHostType,
  config: GitHostAdapterConfig = {},
): GitHostAdapter {
  const factory = gitHostAdapters[type];
  if (!factory) {
    throw new Error(
      `No git host adapter for type: ${type}. Supported: ${Object.keys(gitHostAdapters).join(", ")}`,
    );
  }
  return factory(config);
}

/** @deprecated Use `getGitHostAdapter` instead. */
export const createGitHostAdapter = getGitHostAdapter;

// ── Messaging ────────────────────────────────────────────────

const messagingAdapters: Partial<Record<MessagingType, () => MessagingAdapter>> = {
  noop: () => new NoopMessagingAdapter(),
  slack: () => new SlackMessagingAdapter(),
};

export function getMessagingAdapter(
  type: MessagingType = "noop",
): MessagingAdapter {
  const factory = messagingAdapters[type];
  if (!factory) {
    throw new Error(
      `No messaging adapter for type: ${type}. Supported: ${Object.keys(messagingAdapters).join(", ")}`,
    );
  }
  return factory();
}

// ── Gateway ──────────────────────────────────────────────────

const gatewayAdapters: Partial<Record<GatewayType, (config?: { outputDir?: string }) => GatewayAdapter>> = {
  noop: () => new NoopGatewayAdapter(),
  file: (config) => new FileGatewayAdapter(config?.outputDir ?? "./gateway-output"),
};

export function getGatewayAdapter(
  type: GatewayType = "noop",
  config?: { outputDir?: string },
): GatewayAdapter {
  const factory = gatewayAdapters[type];
  if (!factory) {
    throw new Error(
      `No gateway adapter for type: ${type}. Supported: ${Object.keys(gatewayAdapters).join(", ")}`,
    );
  }
  return factory(config);
}

// ── Sandbox ──────────────────────────────────────────────────

const sandboxAdapters: Partial<Record<SandboxType, () => SandboxAdapter>> = {
  noop: () => new NoopSandboxAdapter(),
};

export function getSandboxAdapter(
  type: SandboxType = "noop",
): SandboxAdapter {
  const factory = sandboxAdapters[type];
  if (!factory) {
    throw new Error(
      `No sandbox adapter for type: ${type}. Supported: ${Object.keys(sandboxAdapters).join(", ")}`,
    );
  }
  return factory();
}

// ── Network Device ──────────────────────────────────────────

const networkDeviceAdapters: Partial<Record<NetworkDeviceType, (config: NetworkDeviceAdapterConfig) => NetworkDeviceAdapter>> = {
  noop: () => new NoopNetworkDeviceAdapter(),
  "snmp-generic": (config) => new SnmpNetworkDeviceAdapter(config),
  gajshield: (config) => new GajShieldNetworkDeviceAdapter(config),
};

export function getNetworkDeviceAdapter(
  type: NetworkDeviceType = "noop",
  config: NetworkDeviceAdapterConfig = { host: "", credentials: {} },
): NetworkDeviceAdapter {
  const factory = networkDeviceAdapters[type];
  if (!factory) {
    throw new Error(
      `No network device adapter for type: ${type}. Supported: ${Object.keys(networkDeviceAdapters).join(", ")}`,
    );
  }
  return factory(config);
}

// ── Identity Provider ───────────────────────────────────────

const identityProviderAdapters: Record<IdentityProviderType, () => IdentityProviderAdapter> = {
  github: () => new GitHubIdentityProviderAdapter(),
  slack: () => new SlackIdentityProviderAdapter(),
  jira: () => new JiraIdentityProviderAdapter(),
  google: () => new GoogleIdentityProviderAdapter(),
};

export function getIdentityProviderAdapter(
  type: IdentityProviderType,
): IdentityProviderAdapter {
  const factory = identityProviderAdapters[type];
  if (!factory) {
    throw new Error(
      `No identity provider adapter for type: ${type}. Supported: ${Object.keys(identityProviderAdapters).join(", ")}`,
    );
  }
  return factory();
}
