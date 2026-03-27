export type InitMode = "project" | "standalone";

export type StandaloneType =
  | "web-app"
  | "node-api"
  | "java-api"
  | "python-api"
  | "node-lib"
  | "java-lib"
  | "python-lib"
  | "ui-lib";

export interface TemplateVars {
  name: string;
  owner: string;
  description: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export const STANDALONE_TYPES: {
  value: StandaloneType;
  label: string;
  description: string;
}[] = [
  // Apps
  { value: "web-app", label: "Web App", description: "Browser-based frontend application" },

  // Services
  { value: "node-api", label: "Node API", description: "Node.js REST/HTTP API service" },
  { value: "java-api", label: "Java API", description: "Java REST/HTTP API service" },
  { value: "python-api", label: "Python API", description: "Python REST/HTTP API service" },

  // Libraries
  { value: "node-lib", label: "Node Library", description: "Shared Node.js/TypeScript library" },
  { value: "java-lib", label: "Java Library", description: "Shared Java library" },
  { value: "python-lib", label: "Python Library", description: "Shared Python library" },
  { value: "ui-lib", label: "UI Library", description: "Shared UI component library" },
];

/** Strips hyphens and lowercases for Java package names (e.g. "my-service" -> "myservice") */
export function toJavaPackage(name: string): string {
  return name.replace(/-/g, "").toLowerCase();
}
