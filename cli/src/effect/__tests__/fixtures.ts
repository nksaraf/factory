import type {
  CatalogSystem,
  CatalogComponent,
} from "@smp/factory-shared/catalog"
import type {
  SiteManifest,
  ManifestComponentDeployment,
} from "../../site/manifest.js"
import type { ComponentState } from "../../site/execution/executor.js"
import type { ISiteConfig, FocusSystem } from "../services/site-config.js"

// ---------------------------------------------------------------------------
// Catalog: api (devable), web (devable), worker (not devable), postgres (resource)
// api depends on postgres
// web depends on api
// ---------------------------------------------------------------------------

const devComponent = (
  ports: number[] = [],
  opts?: { dependsOn?: string[]; type?: string; initFor?: string }
): CatalogComponent =>
  ({
    spec: {
      dev: { command: "pnpm dev" },
      ports: ports.map((p) => ({ port: p, exposure: "public" as const })),
      ...(opts?.dependsOn ? { dependsOn: opts.dependsOn } : {}),
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.initFor ? { initFor: opts.initFor } : {}),
    },
  }) as unknown as CatalogComponent

const infraComponent = (
  ports: number[] = [],
  opts?: { dependsOn?: string[]; type?: string; initFor?: string }
): CatalogComponent =>
  ({
    spec: {
      ports: ports.map((p) => ({ port: p, exposure: "internal" as const })),
      ...(opts?.dependsOn ? { dependsOn: opts.dependsOn } : {}),
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.initFor ? { initFor: opts.initFor } : {}),
    },
  }) as unknown as CatalogComponent

export const testCatalog = {
  name: "test-system",
  slug: "test-system",
  spec: {} as any,
  components: {
    api: devComponent([3001], { dependsOn: ["postgres"] }),
    web: devComponent([3000], { dependsOn: ["api"] }),
    worker: infraComponent([], { dependsOn: ["postgres"] }),
    "init-db": infraComponent([], { type: "init", initFor: "api" }),
  },
  resources: {
    postgres: infraComponent([5432]),
    redis: infraComponent([6379]),
  },
  apis: {},
} as unknown as CatalogSystem

export const emptyCatalog = {
  name: "empty",
  slug: "empty",
  spec: {} as any,
  components: {},
  resources: {},
  apis: {},
} as unknown as CatalogSystem

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

export function makeManifest(
  components: Array<
    Partial<ManifestComponentDeployment> & { componentName: string }
  >
): SiteManifest {
  return {
    version: 1,
    systemDeployment: {
      id: "test-sd",
      name: "test-system",
      site: "test-site",
      realmType: "docker-compose",
    },
    componentDeployments: components.map((c) => ({
      id: c.componentName,
      componentName: c.componentName,
      desiredImage: c.desiredImage ?? `test/${c.componentName}:latest`,
      replicas: c.replicas ?? 1,
      envOverrides: c.envOverrides ?? {},
      resourceOverrides: c.resourceOverrides ?? {},
      status: c.status ?? "running",
    })),
    catalog: testCatalog,
  }
}

export const emptyManifest = makeManifest([])

// ---------------------------------------------------------------------------
// Component states
// ---------------------------------------------------------------------------

export function makeRunningState(
  name: string,
  image = `test/${name}:latest`
): ComponentState {
  return {
    name,
    image,
    status: "running",
    health: "healthy",
    ports: [],
  }
}

export function makeStoppedState(name: string): ComponentState {
  return {
    name,
    image: `test/${name}:latest`,
    status: "stopped",
    health: "none",
    ports: [],
  }
}

export function makeExitedState(name: string): ComponentState {
  return {
    name,
    image: `test/${name}:latest`,
    status: "exited",
    health: "none",
    ports: [],
  }
}

// ---------------------------------------------------------------------------
// Site configs
// ---------------------------------------------------------------------------

export const testFocusSystem: FocusSystem = {
  name: "test-system",
  sdSlug: "test-system",
  rootDir: "/tmp/test-project",
  catalog: testCatalog,
  composeFiles: ["docker-compose.yaml"],
  conventions: {} as any,
  dxConfig: {} as any,
  packages: [],
}

export function makeDevConfig(overrides?: Partial<ISiteConfig>): ISiteConfig {
  return {
    mode: "dev",
    workingDir: "/tmp/test-project",
    port: 4299,
    focusSystem: testFocusSystem,
    reconcileIntervalMs: 30000,
    ...overrides,
  }
}

export function makeUpConfig(overrides?: Partial<ISiteConfig>): ISiteConfig {
  return {
    mode: "up",
    workingDir: "/tmp/test-project",
    port: 4299,
    focusSystem: testFocusSystem,
    reconcileIntervalMs: 30000,
    ...overrides,
  }
}

export function makeControllerConfig(
  overrides?: Partial<ISiteConfig>
): ISiteConfig {
  return {
    mode: "controller",
    workingDir: "/tmp/test-project",
    port: 4299,
    focusSystem: testFocusSystem,
    controllerMode: "standalone",
    reconcileIntervalMs: 30000,
    ...overrides,
  }
}
