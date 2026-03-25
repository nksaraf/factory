import { z } from "zod";

/** Installation role: workbench (developer), site (edge), or factory (control plane). */
export type InstallRole = "workbench" | "site" | "factory";

/** Install connectivity mode. */
export type InstallMode = "connected" | "offline";

/** Phases of the 6-phase install sequence. */
export const InstallPhase = {
  PREFLIGHT: "preflight",
  K3S_BOOTSTRAP: "k3s-bootstrap",
  IMAGE_LOAD: "image-load",
  PLATFORM_INSTALL: "platform-install",
  POST_INSTALL: "post-install",
  HEALTH_VERIFY: "health-verify",
} as const;

export type InstallPhase = (typeof InstallPhase)[keyof typeof InstallPhase];

/** Structured result from preflight checks. */
export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  required: boolean;
}

export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
  role: InstallRole;
}

/** Node entry in the install manifest. */
export interface ManifestNode {
  name: string;
  role: "server" | "agent";
  joinedAt: string;
  ip: string;
}

/** Upgrade record in the install manifest. */
export interface ManifestUpgrade {
  fromVersion: string;
  toVersion: string;
  upgradedAt: string;
}

/** Stored as ConfigMap `dx-install-manifest` in `dx-system` namespace. */
export interface InstallManifest {
  version: 1;
  role: InstallRole;
  installedAt: string;
  dxVersion: string;
  installMode: InstallMode;
  k3sVersion: string;
  helmChartVersion: string;
  siteName: string;
  domain: string;
  enabledPlanes: string[];
  nodes: ManifestNode[];
  upgrades: ManifestUpgrade[];
}

/** Manifest for an offline bundle (bundle/manifest.json). Cluster-only — workbenches don't use bundles. */
export const bundleManifestSchema = z.object({
  version: z.literal(1),
  role: z.enum(["site", "factory"]),
  dxVersion: z.string(),
  k3sVersion: z.string(),
  helmChartVersion: z.string(),
  images: z.array(
    z.object({
      name: z.string(),
      tag: z.string(),
      file: z.string(),
      sha256: z.string(),
    })
  ),
  createdAt: z.string(),
});

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

/** Planes enabled per role. */
export const SITE_PLANES = ["control", "service", "data"] as const;
export const FACTORY_PLANES = [
  ...SITE_PLANES,
  "build",
  "fleet",
  "commerce",
  "product",
  "observability",
  "gateway",
  "agent",
  "sandbox",
] as const;
export const WORKBENCH_PLANES = [] as const;

export function planesForRole(role: InstallRole): string[] {
  if (role === "factory") return [...FACTORY_PLANES];
  if (role === "site") return [...SITE_PLANES];
  return [...WORKBENCH_PLANES];
}
