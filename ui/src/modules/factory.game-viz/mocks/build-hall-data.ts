// Mock Factory platform data matching real entity schemas

export const MOCK_REPOS = [
  { slug: "factory-api", name: "factory-api", kind: "service" },
  { slug: "factory-ui", name: "factory-ui", kind: "app" },
  { slug: "shared-lib", name: "shared-lib", kind: "library" },
  { slug: "infra-config", name: "infra-config", kind: "infra" },
  { slug: "auth-service", name: "auth-service", kind: "service" },
]

export const MOCK_BUILDS = [
  {
    id: "b1",
    repo: "factory-api",
    status: "success" as const,
    version: "1.4.2",
  },
  {
    id: "b2",
    repo: "factory-api",
    status: "running" as const,
    version: "1.4.3",
  },
  {
    id: "b3",
    repo: "factory-ui",
    status: "success" as const,
    version: "2.1.0",
  },
  { id: "b4", repo: "factory-ui", status: "failed" as const, version: "2.1.1" },
  {
    id: "b5",
    repo: "shared-lib",
    status: "success" as const,
    version: "0.8.0",
  },
  {
    id: "b6",
    repo: "shared-lib",
    status: "pending" as const,
    version: "0.8.1",
  },
  {
    id: "b7",
    repo: "infra-config",
    status: "running" as const,
    version: "3.0.0",
  },
  {
    id: "b8",
    repo: "auth-service",
    status: "success" as const,
    version: "1.2.0",
  },
  {
    id: "b9",
    repo: "factory-api",
    status: "pending" as const,
    version: "1.4.4",
  },
  {
    id: "b10",
    repo: "factory-ui",
    status: "running" as const,
    version: "2.1.2",
  },
]

export const MOCK_ARTIFACTS = [
  { id: "a1", repo: "factory-api", kind: "container", version: "1.4.2" },
  { id: "a2", repo: "factory-ui", kind: "container", version: "2.1.0" },
  { id: "a3", repo: "shared-lib", kind: "npm", version: "0.8.0" },
  { id: "a4", repo: "auth-service", kind: "container", version: "1.2.0" },
  { id: "a5", repo: "factory-api", kind: "container", version: "1.4.1" },
  { id: "a6", repo: "factory-ui", kind: "container", version: "2.0.9" },
  { id: "a7", repo: "shared-lib", kind: "npm", version: "0.7.9" },
  { id: "a8", repo: "infra-config", kind: "binary", version: "2.9.0" },
  { id: "a9", repo: "factory-api", kind: "container", version: "1.4.0" },
  { id: "a10", repo: "factory-ui", kind: "container", version: "2.0.8" },
  { id: "a11", repo: "auth-service", kind: "container", version: "1.1.9" },
  { id: "a12", repo: "shared-lib", kind: "npm", version: "0.7.8" },
  { id: "a13", repo: "infra-config", kind: "binary", version: "2.8.0" },
  { id: "a14", repo: "factory-api", kind: "container", version: "1.3.9" },
  { id: "a15", repo: "auth-service", kind: "container", version: "1.1.8" },
]

export const MOCK_SYNC_WORKERS = [
  { id: "w1", repo: "factory-api", status: "idle" as const },
  { id: "w2", repo: "factory-ui", status: "syncing" as const },
  { id: "w3", repo: "shared-lib", status: "idle" as const },
  { id: "w4", repo: "infra-config", status: "syncing" as const },
]
