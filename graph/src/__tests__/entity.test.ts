import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  defineEntity,
  compileEntity,
  compileGraph,
  link,
  Reconcilable,
  TeamOwned,
  Addressable,
} from "../schema/index"

const HostSpec = z.object({
  hostname: z.string(),
  ip: z.string().optional(),
  os: z.enum(["linux", "macos", "windows"]),
  arch: z.enum(["x86_64", "aarch64"]),
  cores: z.number(),
  memoryGb: z.number(),
  tags: z.array(z.string()).optional(),
})

const HostStatus = z.object({
  state: z.enum(["online", "offline", "degraded"]),
  lastSeen: z.string().optional(),
  cpuUsage: z.number().optional(),
  memoryUsage: z.number().optional(),
})

describe("defineEntity", () => {
  test("creates an entity definition with __kind marker", () => {
    const Host = defineEntity("host", {
      namespace: "infra",
      prefix: "hst",
      description: "A physical or virtual machine",
      spec: HostSpec,
      status: HostStatus,
      metadata: "standard",
      traits: [Reconcilable, TeamOwned],
      annotations: {
        hostname: { searchable: true, sortable: true, visibility: "prominent" },
        ip: { searchable: true },
      },
      identity: { slug: { scope: "global" }, titleProperty: "hostname" },
      links: {
        site: link.manyToOne("site", { fk: "siteId", inverse: "hosts" }),
      },
      reconciliation: true,
    })

    expect(Host.__kind).toBe("host")
    expect(Host.kind).toBe("host")
    expect(Host.namespace).toBe("infra")
    expect(Host.prefix).toBe("hst")
    expect(Host.traits).toHaveLength(2)
  })
})

describe("compileEntity", () => {
  test("compiles a Host entity to IR with correct structure", () => {
    const Host = defineEntity("host", {
      namespace: "infra",
      prefix: "hst",
      description: "A physical or virtual machine",
      spec: HostSpec,
      status: HostStatus,
      metadata: "standard",
      traits: [Reconcilable, TeamOwned],
      annotations: {
        hostname: { searchable: true, sortable: true, visibility: "prominent" },
        ip: { searchable: true },
      },
      identity: { slug: { scope: "global" }, titleProperty: "hostname" },
      links: {
        site: link.manyToOne("site", { fk: "siteId", inverse: "hosts" }),
      },
      reconciliation: true,
    })

    const ir = compileEntity(Host)

    // Basic fields
    expect(ir.kind).toBe("host")
    expect(ir.namespace).toBe("infra")
    expect(ir.prefix).toBe("hst")
    expect(ir.plural).toBe("hosts")
    expect(ir.description).toBe("A physical or virtual machine")

    // Traits merged
    expect(ir.traits).toContain("reconcilable")
    expect(ir.traits).toContain("team-owned")

    // Schemas compiled to JSON Schema
    expect(ir.schemas.spec.type).toBe("object")
    expect(ir.schemas.spec.properties?.hostname).toEqual({ type: "string" })
    expect(ir.schemas.spec.properties?.os).toEqual({
      type: "string",
      enum: ["linux", "macos", "windows"],
    })
    expect(ir.schemas.spec.properties?.cores).toEqual({ type: "number" })
    expect(ir.schemas.spec.required).toContain("hostname")
    expect(ir.schemas.spec.required).toContain("os")
    expect(ir.schemas.spec.required).not.toContain("ip")

    // Status schema
    expect(ir.schemas.status.type).toBe("object")
    expect(ir.schemas.status.properties?.state).toBeDefined()

    // Standard metadata
    expect(ir.schemas.metadata.type).toBe("object")
    expect(ir.schemas.metadata.properties?.labels).toBeDefined()
    expect(ir.schemas.metadata.properties?.tags).toBeDefined()

    // Identity
    expect(ir.identity.slugScope).toBe("global")
    expect(ir.identity.titleProperty).toBe("hostname")

    // Annotations include both entity and trait annotations
    expect(ir.annotations.hostname).toEqual({
      searchable: true,
      sortable: true,
      visibility: "prominent",
    })

    // Links include entity links + trait links (TeamOwned adds ownerTeam)
    expect(ir.links.site).toBeDefined()
    expect(ir.links.site.cardinality).toBe("many-to-one")
    expect(ir.links.site.target).toBe("site")
    expect(ir.links.site.fk).toBe("siteId")
    expect(ir.links.ownerTeam).toBeDefined()
    expect(ir.links.ownerTeam.target).toBe("team")

    // Derived includes Reconcilable's isConverged/isDrifted
    expect(ir.derived.isConverged).toBeDefined()
    expect(ir.derived.isConverged.type).toBe("boolean")
    expect(ir.derived.isDrifted).toBeDefined()

    // Reconciliation flag
    expect(ir.reconciliation).toBe(true)

    // Defaults
    expect(ir.bitemporal).toBe(false)
    expect(ir.softDelete).toBe(false)
    expect(ir.visibility).toBe("normal")
    expect(ir.lifecycle).toBe("production")
  })

  test("auto-pluralizes entity kinds correctly", () => {
    const cases: Array<{ kind: string; expected: string }> = [
      { kind: "host", expected: "hosts" },
      { kind: "proxy", expected: "proxies" },
      { kind: "bus", expected: "buses" },
      { kind: "box", expected: "boxes" },
      { kind: "match", expected: "matches" },
      { kind: "key", expected: "keys" },
    ]

    for (const { kind, expected } of cases) {
      const entity = defineEntity(kind, {
        namespace: "test",
        prefix: "tst",
        spec: { type: "object", properties: {} },
      })
      const ir = compileEntity(entity)
      expect(ir.plural).toBe(expected)
    }
  })

  test("respects explicit plural override", () => {
    const entity = defineEntity("person", {
      namespace: "org",
      prefix: "per",
      plural: "people",
      spec: { type: "object", properties: {} },
    })
    const ir = compileEntity(entity)
    expect(ir.plural).toBe("people")
  })
})

describe("compileGraph", () => {
  test("compiles multiple entities into a full GraphIR", () => {
    const Host = defineEntity("host", {
      namespace: "infra",
      prefix: "hst",
      spec: HostSpec,
      traits: [Reconcilable],
      links: {
        site: link.manyToOne("site", { fk: "siteId" }),
      },
      reconciliation: true,
    })

    const SiteSpec = z.object({
      domain: z.string(),
      mode: z.enum(["container", "native"]),
    })

    const Site = defineEntity("site", {
      namespace: "ops",
      prefix: "ste",
      spec: SiteSpec,
      traits: [Addressable],
      links: {
        hosts: link.oneToMany("host", { targetFk: "siteId" }),
      },
    })

    const TeamSpec = z.object({
      displayName: z.string(),
      email: z.string().optional(),
    })

    const Team = defineEntity("team", {
      namespace: "org",
      prefix: "tea",
      spec: TeamSpec,
    })

    const ir = compileGraph([Host, Site, Team], {
      traits: [Reconcilable, TeamOwned, Addressable],
    })

    // Schema metadata
    expect(ir.$schema).toBe("https://graph.dev/ir/v1")
    expect(ir.version).toBe("1.0")

    // Namespaces
    expect(Object.keys(ir.namespaces)).toHaveLength(3)
    expect(ir.namespaces.infra.entityKinds).toContain("host")
    expect(ir.namespaces.ops.entityKinds).toContain("site")
    expect(ir.namespaces.org.entityKinds).toContain("team")

    // Entities
    expect(Object.keys(ir.entities)).toHaveLength(3)
    expect(ir.entities.host.kind).toBe("host")
    expect(ir.entities.site.kind).toBe("site")
    expect(ir.entities.team.kind).toBe("team")

    // Cross-references via links
    expect(ir.entities.host.links.site.target).toBe("site")
    expect(ir.entities.site.links.hosts.target).toBe("host")

    // Trait IR compiled
    expect(Object.keys(ir.traits)).toHaveLength(3)
    expect(ir.traits.reconcilable.name).toBe("reconcilable")
    expect(ir.traits["team-owned"].links?.ownerTeam).toBeDefined()
    expect(ir.traits.addressable.links?.routes).toBeDefined()

    // Site gets Addressable's routes link
    expect(ir.entities.site.links.routes).toBeDefined()
    expect(ir.entities.site.links.routes.target).toBe("route")
  })

  test("groups multiple entities in the same namespace", () => {
    const A = defineEntity("deployment", {
      namespace: "ops",
      prefix: "dep",
      spec: { type: "object", properties: {} },
    })
    const B = defineEntity("service", {
      namespace: "ops",
      prefix: "svc",
      spec: { type: "object", properties: {} },
    })

    const ir = compileGraph([A, B])

    expect(ir.namespaces.ops.entityKinds).toContain("deployment")
    expect(ir.namespaces.ops.entityKinds).toContain("service")
    expect(ir.namespaces.ops.entityKinds).toHaveLength(2)
  })
})

describe("link helpers", () => {
  test("creates correct link definitions", () => {
    const mto = link.manyToOne("team", { fk: "teamId", required: true })
    expect(mto.cardinality).toBe("many-to-one")
    expect(mto.target).toBe("team")
    expect(mto.fk).toBe("teamId")
    expect(mto.required).toBe(true)

    const otm = link.oneToMany("host", { targetFk: "siteId" })
    expect(otm.cardinality).toBe("one-to-many")

    const mtm = link.manyToMany("tag", {
      junction: {
        sourceFk: "entityId",
        targetFk: "tagId",
        table: "entity_tags",
      },
    })
    expect(mtm.cardinality).toBe("many-to-many")
    expect(mtm.junction?.table).toBe("entity_tags")

    const oto = link.oneToOne("profile")
    expect(oto.cardinality).toBe("one-to-one")
    expect(oto.target).toBe("profile")
  })
})

describe("schema adapter", () => {
  test("detects and converts Zod schemas to JSON Schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
      role: z.enum(["admin", "user"]),
      tags: z.array(z.string()),
      nickname: z.string().optional(),
    })

    const entity = defineEntity("person", {
      namespace: "org",
      prefix: "per",
      spec: schema,
    })
    const ir = compileEntity(entity)

    expect(ir.schemas.spec.type).toBe("object")
    expect(ir.schemas.spec.properties?.name).toEqual({ type: "string" })
    expect(ir.schemas.spec.properties?.age).toEqual({ type: "number" })
    expect(ir.schemas.spec.properties?.active).toEqual({ type: "boolean" })
    expect(ir.schemas.spec.properties?.role).toEqual({
      type: "string",
      enum: ["admin", "user"],
    })
    expect(ir.schemas.spec.properties?.tags).toEqual({
      type: "array",
      items: { type: "string" },
    })
    expect(ir.schemas.spec.required).toContain("name")
    expect(ir.schemas.spec.required).toContain("age")
    expect(ir.schemas.spec.required).not.toContain("nickname")
  })

  test("passes through raw JSON Schema objects", () => {
    const rawSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
      },
      required: ["name"],
    }

    const entity = defineEntity("widget", {
      namespace: "test",
      prefix: "wdg",
      spec: rawSchema,
    })
    const ir = compileEntity(entity)

    expect(ir.schemas.spec).toEqual(rawSchema)
  })
})
