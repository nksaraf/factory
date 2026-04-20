import { z } from "zod"
import {
  defineEntity,
  link,
  Bitemporal,
  TeamOwned,
  Junction,
} from "../schema/index"

export const System = defineEntity("system", {
  namespace: "software",
  prefix: "sys",
  description:
    "A deployable software system (product, platform, service suite)",
  traits: [Bitemporal, TeamOwned],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    namespace: z.string().optional(),
    lifecycle: z
      .enum(["incubating", "active", "deprecated", "retired"])
      .optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
  }),
  links: {
    components: link.oneToMany("component", {
      targetFk: "systemId",
      inverse: "system",
    }),
  },
})

export const Component = defineEntity("component", {
  namespace: "software",
  prefix: "cmp",
  description: "A single deployable unit within a system",
  traits: [Bitemporal, TeamOwned],
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    type: z.enum([
      "service",
      "worker",
      "task",
      "cronjob",
      "website",
      "library",
      "cli",
      "agent",
      "gateway",
      "database",
      "cache",
      "queue",
      "storage",
      "search",
    ]),
    lifecycle: z
      .enum(["incubating", "active", "deprecated", "retired"])
      .optional(),
    description: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "components",
      required: true,
    }),
  },
})

export const SoftwareApi = defineEntity("softwareApi", {
  namespace: "software",
  prefix: "api",
  plural: "softwareApis",
  description: "API exposed by a system (OpenAPI, gRPC, GraphQL, etc.)",
  metadata: "standard",
  spec: z.object({
    definitionRef: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "apis",
      required: true,
    }),
    providedByComponent: link.manyToOne("component", {
      fk: "providedByComponentId",
      inverse: "providedApis",
    }),
  },
})

export const Artifact = defineEntity("artifact", {
  namespace: "software",
  prefix: "art",
  plural: "artifacts",
  description: "Build artifact: container image, npm package, binary, etc.",
  spec: z.object({
    imageRef: z.string().optional(),
    imageDigest: z.string().optional(),
    sizeBytes: z.number().optional(),
    arch: z.enum(["amd64", "arm64", "multi"]).optional(),
    registry: z.string().optional(),
  }),
  links: {
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "artifacts",
      required: true,
    }),
  },
})

export const Release = defineEntity("release", {
  namespace: "software",
  prefix: "rel",
  plural: "releases",
  description: "Versioned release of a system",
  spec: z.object({
    version: z.string(),
    status: z
      .enum(["draft", "staging", "production", "superseded", "failed"])
      .optional(),
    releaseNotes: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "releases",
      required: true,
    }),
  },
})

export const Template = defineEntity("template", {
  namespace: "software",
  prefix: "tmpl",
  plural: "templates",
  description: "Workbench/project/component template",
  metadata: "standard",
  spec: z.object({
    kind: z.string(),
    runtime: z.string().optional(),
    framework: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {},
})

export const Product = defineEntity("product", {
  namespace: "software",
  prefix: "prod",
  plural: "products",
  description: "Customer-facing product",
  metadata: "standard",
  spec: z.object({
    description: z.string().optional(),
    brand: z.string().optional(),
    website: z.string().optional(),
    icon: z.string().optional(),
  }),
  links: {},
})

export const Capability = defineEntity("capability", {
  namespace: "software",
  prefix: "cap",
  plural: "capabilities",
  description: "Feature capability that can be metered and entitled",
  traits: [TeamOwned],
  metadata: "standard",
  spec: z.object({
    activation: z.enum(["flag", "config", "deploy", "independent"]).optional(),
    visibility: z.enum(["listed", "unlisted", "internal"]).optional(),
    description: z.string().optional(),
  }),
  links: {
    product: link.manyToOne("product", {
      fk: "productId",
      inverse: "capabilities",
    }),
  },
})

export const ProductSystem = defineEntity("product-system", {
  namespace: "software",
  prefix: "psys",
  plural: "productSystems",
  description: "Links a product to a system it contains",
  traits: [Junction],
  spec: z.object({}),
  links: {
    product: link.manyToOne("product", {
      fk: "productId",
      inverse: "productSystems",
      required: true,
      cascade: "delete",
    }),
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "productSystems",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ReleaseArtifactPin = defineEntity("release-artifact-pin", {
  namespace: "software",
  prefix: "rap",
  plural: "releaseArtifactPins",
  description: "Links a release to a specific artifact version",
  traits: [Junction],
  spec: z.object({}),
  links: {
    release: link.manyToOne("release", {
      fk: "releaseId",
      inverse: "artifactPins",
      required: true,
      cascade: "delete",
    }),
    artifact: link.manyToOne("artifact", {
      fk: "artifactId",
      inverse: "releasePins",
      required: true,
      cascade: "delete",
    }),
  },
})
