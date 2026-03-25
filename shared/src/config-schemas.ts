import { z } from "zod";

export const dependencyConfigSchema = z.object({
  image: z.string(),
  /** Published host port (left side of host:container mapping). */
  port: z.number(),
  /** Service port inside the container when it differs (e.g. host 5433 → 5432). */
  container_port: z.number().optional(),
  env: z.record(z.string()).default({}),
  healthcheck: z.string().optional(),
  volumes: z.array(z.string()).default([]),
});

export const connectionConfigSchema = z.object({
  module: z.string(),
  component: z.string(),
  env_var: z.string(),
  local_default: z.string().optional(),
  optional: z.boolean().default(false),
});

/** Routing / compose hints for a component (paths, ports, worker). */
export const componentRefBaseSchema = z.object({
  path: z.string(),
  /** Host port published on your machine. */
  port: z.number().optional(),
  /** Container port when it differs from `port` (e.g. host 4100 → container 80). */
  container_port: z.number().optional(),
  healthcheck: z.string().optional(),
  worker: z.boolean().default(false),
  type: z.enum(["node", "python", "java"]).optional(),
});

export const buildConfigSchema = z.object({
  dockerfile: z.string().default("Dockerfile"),
  context: z.string().default("."),
});

export const devConfigSchema = z.object({
  command: z.string().optional(),
  sync: z.array(z.string()).default([]),
});

export const dxComponentYamlSchema = z.object({
  /** When set, compose uses this image instead of building from Dockerfile. */
  image: z.string().optional(),
  build: buildConfigSchema.optional(),
  dev: devConfigSchema.optional(),
  test: z.string().optional(),
  lint: z.string().optional(),
});

/**
 * Component entry in dx.yaml: path/ports plus optional inline dx-component.yaml body.
 */
export const componentRefSchema = componentRefBaseSchema.merge(
  dxComponentYamlSchema.partial()
);

export const dxYamlSchema = z.object({
  module: z.string(),
  team: z.string(),
  /**
   * Optional build/dev/test/lint/image may appear inline; they merge with
   * dx-component.yaml under `path`, with inline winning on conflict.
   */
  components: z.record(componentRefSchema),
  dependencies: z.record(dependencyConfigSchema).default({}),
  connections: z.record(connectionConfigSchema).default({}),
});

export type DxYaml = z.infer<typeof dxYamlSchema>;
export type DxComponentYaml = z.infer<typeof dxComponentYamlSchema>;
export type DxComponentRef = z.infer<typeof componentRefSchema>;
export type DependencyConfig = z.infer<typeof dependencyConfigSchema>;
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;
