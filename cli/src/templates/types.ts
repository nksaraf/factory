// ─── Init types ─────────────────────────────────────────────

/** Init types — project scaffolds a full monorepo, others match componentTypeSchema in catalog.ts */
export type InitType = "project" | "service" | "website" | "library";

/** Matches spec.runtime in shared/src/catalog.ts */
export type Runtime = "node" | "java" | "python";

export type Framework =
  | "elysia"
  | "spring-boot"
  | "fastapi"
  | "react-vinxi"
  | "react-tailwind"
  | "none";

export interface ComponentSpec {
  type: Exclude<InitType, "project">;
  runtime: Runtime;
  framework: Framework;
}

export const INIT_TYPES: { value: InitType; label: string; description: string }[] = [
  { value: "project", label: "Project", description: "Full monorepo with apps, services, packages, and resources" },
  { value: "service", label: "Service", description: "Backend API service" },
  { value: "website", label: "Website", description: "Frontend web application" },
  { value: "library", label: "Library", description: "Shared library/package" },
];

// ─── Internal template key ──────────────────────────────────
// StandaloneType is kept as a private dispatch key for templates/standalone/*.ts.
// It is NOT exposed in the CLI.

export type StandaloneType =
  | "web-app"
  | "node-api"
  | "java-api"
  | "python-api"
  | "node-lib"
  | "java-lib"
  | "python-lib"
  | "ui-lib";

// ─── Framework registry ─────────────────────────────────────

export interface FrameworkEntry {
  value: Framework;
  label: string;
  type: Exclude<InitType, "project">;
  runtime: Runtime;
  description: string;
  /** Maps to existing standalone template file */
  templateKey: StandaloneType;
}

export const FRAMEWORKS: FrameworkEntry[] = [
  // Services
  { value: "elysia",         label: "Elysia",           type: "service", runtime: "node",   description: "Elysia + Drizzle REST API",      templateKey: "node-api" },
  { value: "spring-boot",    label: "Spring Boot",      type: "service", runtime: "java",   description: "Spring Boot REST API",            templateKey: "java-api" },
  { value: "fastapi",        label: "FastAPI",          type: "service", runtime: "python", description: "FastAPI REST API",                templateKey: "python-api" },
  // Websites
  { value: "react-vinxi",    label: "React + Vinxi",    type: "website", runtime: "node",   description: "React SPA with SSR",              templateKey: "web-app" },
  // Libraries
  { value: "react-tailwind", label: "React + Tailwind",  type: "library", runtime: "node",   description: "UI component library",            templateKey: "ui-lib" },
  { value: "none",           label: "Plain",            type: "library", runtime: "node",   description: "TypeScript library",              templateKey: "node-lib" },
  { value: "none",           label: "Plain",            type: "library", runtime: "java",   description: "Java library",                    templateKey: "java-lib" },
  { value: "none",           label: "Plain",            type: "library", runtime: "python", description: "Python library",                  templateKey: "python-lib" },
];

// ─── Backward compat: old --type values ─────────────────────

/** Maps legacy --type values (e.g. "node-api") to the new ComponentSpec model. */
const LEGACY_TYPE_MAP: Record<string, ComponentSpec> = {
  "node-api":    { type: "service", runtime: "node",   framework: "elysia" },
  "java-api":    { type: "service", runtime: "java",   framework: "spring-boot" },
  "python-api":  { type: "service", runtime: "python", framework: "fastapi" },
  "web-app":     { type: "website", runtime: "node",   framework: "react-vinxi" },
  "ui-lib":      { type: "library", runtime: "node",   framework: "react-tailwind" },
  "node-lib":    { type: "library", runtime: "node",   framework: "none" },
  "java-lib":    { type: "library", runtime: "java",   framework: "none" },
  "python-lib":  { type: "library", runtime: "python", framework: "none" },
};

/** Returns a ComponentSpec if the value is a legacy type string, otherwise undefined. */
export function parseLegacyType(value: string): ComponentSpec | undefined {
  return LEGACY_TYPE_MAP[value];
}

// ─── Resolvers ──────────────────────────────────────────────

/** Resolve a ComponentSpec to the internal StandaloneType template key. */
export function resolveTemplateKey(spec: ComponentSpec): StandaloneType {
  const entry = FRAMEWORKS.find(
    (f) => f.type === spec.type && f.runtime === spec.runtime && f.value === spec.framework,
  );
  if (!entry) {
    throw new Error(
      `No template for type=${spec.type} runtime=${spec.runtime} framework=${spec.framework}`,
    );
  }
  return entry.templateKey;
}

/** Get available frameworks for a given type and runtime. */
export function getFrameworksForTypeAndRuntime(
  type: Exclude<InitType, "project">,
  runtime: Runtime,
): FrameworkEntry[] {
  return FRAMEWORKS.filter((f) => f.type === type && f.runtime === runtime);
}

/** Get available runtimes for a given type. */
export function getRuntimesForType(type: Exclude<InitType, "project">): Runtime[] {
  const runtimes = new Set(FRAMEWORKS.filter((f) => f.type === type).map((f) => f.runtime));
  return [...runtimes];
}

// ─── Shared types ───────────────────────────────────────────

export interface TemplateVars {
  name: string;
  owner: string;
  description: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

// ─── Legacy compat export ───────────────────────────────────
// STANDALONE_TYPES is kept for test backward compat but should not be used in new code.

export const STANDALONE_TYPES: { value: StandaloneType; label: string; description: string }[] = [
  { value: "web-app", label: "Web App", description: "Browser-based frontend application" },
  { value: "node-api", label: "Node API", description: "Node.js REST/HTTP API service" },
  { value: "java-api", label: "Java API", description: "Java REST/HTTP API service" },
  { value: "python-api", label: "Python API", description: "Python REST/HTTP API service" },
  { value: "node-lib", label: "Node Library", description: "Shared Node.js/TypeScript library" },
  { value: "java-lib", label: "Java Library", description: "Shared Java library" },
  { value: "python-lib", label: "Python Library", description: "Shared Python library" },
  { value: "ui-lib", label: "UI Library", description: "Shared UI component library" },
];

/** Strips hyphens and lowercases for Java package names (e.g. "my-service" -> "myservice") */
export function toJavaPackage(name: string): string {
  return name.replace(/-/g, "").toLowerCase();
}
