import { describe, expect, test } from "bun:test"
import {
  DxFactoryGraph,
  Team,
  Principal,
  Estate,
  Host,
  Realm,
  System,
  Component,
  Site,
  SystemDeployment,
  ComponentDeployment,
  Workbench,
} from "./index"

describe("DxFactoryGraph", () => {
  test("compiles without errors", () => {
    expect(DxFactoryGraph).toBeDefined()
    expect(DxFactoryGraph.$schema).toBe("https://graph.dev/ir/v1")
    expect(DxFactoryGraph.version).toBe("1.0")
  })

  test("has 4 namespaces", () => {
    const ns = Object.keys(DxFactoryGraph.namespaces).sort()
    expect(ns).toEqual(["infra", "ops", "org", "software"])
  })

  test("org namespace has team and principal", () => {
    const org = DxFactoryGraph.namespaces.org
    expect(org.entityKinds).toContain("team")
    expect(org.entityKinds).toContain("principal")
    expect(org.entityKinds).toHaveLength(2)
  })

  test("infra namespace has estate, host, realm", () => {
    const infra = DxFactoryGraph.namespaces.infra
    expect(infra.entityKinds).toContain("estate")
    expect(infra.entityKinds).toContain("host")
    expect(infra.entityKinds).toContain("realm")
    expect(infra.entityKinds).toHaveLength(3)
  })

  test("software namespace has system and component", () => {
    const sw = DxFactoryGraph.namespaces.software
    expect(sw.entityKinds).toContain("system")
    expect(sw.entityKinds).toContain("component")
    expect(sw.entityKinds).toHaveLength(2)
  })

  test("ops namespace has site, systemDeployment, componentDeployment, workbench", () => {
    const ops = DxFactoryGraph.namespaces.ops
    expect(ops.entityKinds).toContain("site")
    expect(ops.entityKinds).toContain("systemDeployment")
    expect(ops.entityKinds).toContain("componentDeployment")
    expect(ops.entityKinds).toContain("workbench")
    expect(ops.entityKinds).toHaveLength(4)
  })

  test("each entity has expected kind, prefix, namespace", () => {
    const expectations = [
      { kind: "team", prefix: "team", namespace: "org" },
      { kind: "principal", prefix: "prin", namespace: "org" },
      { kind: "estate", prefix: "est", namespace: "infra" },
      { kind: "host", prefix: "host", namespace: "infra" },
      { kind: "realm", prefix: "rlm", namespace: "infra" },
      { kind: "system", prefix: "sys", namespace: "software" },
      { kind: "component", prefix: "cmp", namespace: "software" },
      { kind: "site", prefix: "site", namespace: "ops" },
      { kind: "systemDeployment", prefix: "sdp", namespace: "ops" },
      { kind: "componentDeployment", prefix: "cdp", namespace: "ops" },
      { kind: "workbench", prefix: "wbnch", namespace: "ops" },
    ]

    for (const { kind, prefix, namespace } of expectations) {
      const entity = DxFactoryGraph.entities[kind]
      expect(entity).toBeDefined()
      expect(entity.prefix).toBe(prefix)
      expect(entity.namespace).toBe(namespace)
    }
  })
})

describe("entity links", () => {
  test("team has parent self-ref link", () => {
    const team = DxFactoryGraph.entities.team
    expect(team.links.parent).toBeDefined()
    expect(team.links.parent.target).toBe("team")
    expect(team.links.parent.fk).toBe("parentTeamId")
    expect(team.links.parent.cardinality).toBe("many-to-one")
  })

  test("host has estate link", () => {
    const host = DxFactoryGraph.entities.host
    expect(host.links.estate).toBeDefined()
    expect(host.links.estate.target).toBe("estate")
    expect(host.links.estate.fk).toBe("estateId")
    expect(host.links.estate.cardinality).toBe("many-to-one")
  })

  test("estate has hosts and realms one-to-many links", () => {
    const estate = DxFactoryGraph.entities.estate
    expect(estate.links.hosts).toBeDefined()
    expect(estate.links.hosts.target).toBe("host")
    expect(estate.links.hosts.cardinality).toBe("one-to-many")
    expect(estate.links.hosts.targetFk).toBe("estateId")

    expect(estate.links.realms).toBeDefined()
    expect(estate.links.realms.target).toBe("realm")
    expect(estate.links.realms.cardinality).toBe("one-to-many")
  })

  test("systemDeployment has dual lineage — both site and system links", () => {
    const sd = DxFactoryGraph.entities.systemDeployment
    expect(sd.links.site).toBeDefined()
    expect(sd.links.site.target).toBe("site")
    expect(sd.links.site.required).toBe(true)

    expect(sd.links.system).toBeDefined()
    expect(sd.links.system.target).toBe("system")
    expect(sd.links.system.required).toBe(true)

    expect(sd.links.realm).toBeDefined()
    expect(sd.links.realm.target).toBe("realm")
  })

  test("componentDeployment has dual lineage — systemDeployment and component", () => {
    const cd = DxFactoryGraph.entities.componentDeployment
    expect(cd.links.systemDeployment).toBeDefined()
    expect(cd.links.systemDeployment.target).toBe("systemDeployment")
    expect(cd.links.systemDeployment.required).toBe(true)

    expect(cd.links.component).toBeDefined()
    expect(cd.links.component.target).toBe("component")
    expect(cd.links.component.required).toBe(true)
  })

  test("workbench links to site, host, realm, and owner", () => {
    const wb = DxFactoryGraph.entities.workbench
    expect(wb.links.site.target).toBe("site")
    expect(wb.links.host.target).toBe("host")
    expect(wb.links.realm.target).toBe("realm")
    expect(wb.links.owner.target).toBe("principal")
  })

  test("component links to system", () => {
    const cmp = DxFactoryGraph.entities.component
    expect(cmp.links.system).toBeDefined()
    expect(cmp.links.system.target).toBe("system")
    expect(cmp.links.system.fk).toBe("systemId")
  })

  test("site has recursive parent link", () => {
    const site = DxFactoryGraph.entities.site
    expect(site.links.parent).toBeDefined()
    expect(site.links.parent.target).toBe("site")
    expect(site.links.parent.fk).toBe("parentSiteId")
  })
})

describe("traits", () => {
  test("estate has reconcilable trait", () => {
    const estate = DxFactoryGraph.entities.estate
    expect(estate.traits).toContain("reconcilable")
    expect(estate.reconciliation).toBe(true)
    expect(estate.derived.isConverged).toBeDefined()
    expect(estate.derived.isDrifted).toBeDefined()
  })

  test("system has bitemporal and team-owned traits", () => {
    const sys = DxFactoryGraph.entities.system
    expect(sys.traits).toContain("bitemporal")
    expect(sys.traits).toContain("team-owned")
    expect(sys.bitemporal).toBe(true)
    expect(sys.links.ownerTeam).toBeDefined()
    expect(sys.links.ownerTeam.target).toBe("team")
  })

  test("site has both reconcilable and bitemporal traits", () => {
    const site = DxFactoryGraph.entities.site
    expect(site.traits).toContain("reconcilable")
    expect(site.traits).toContain("bitemporal")
    expect(site.reconciliation).toBe(true)
    expect(site.bitemporal).toBe(true)
  })

  test("component has team-owned trait with ownerTeam link", () => {
    const cmp = DxFactoryGraph.entities.component
    expect(cmp.traits).toContain("team-owned")
    expect(cmp.links.ownerTeam).toBeDefined()
    expect(cmp.links.ownerTeam.target).toBe("team")
    expect(cmp.links.ownerTeam.fk).toBe("ownerTeamId")
  })

  test("team is bitemporal but not reconcilable", () => {
    const team = DxFactoryGraph.entities.team
    expect(team.bitemporal).toBe(true)
    expect(team.reconciliation).toBe(false)
    expect(team.traits).not.toContain("reconcilable")
  })
})

describe("serialization", () => {
  test("the IR is fully serializable to JSON", () => {
    const json = JSON.stringify(DxFactoryGraph)
    expect(json).toBeDefined()
    expect(typeof json).toBe("string")

    const parsed = JSON.parse(json)
    expect(parsed.$schema).toBe("https://graph.dev/ir/v1")
    expect(Object.keys(parsed.entities)).toHaveLength(11)
    expect(Object.keys(parsed.namespaces)).toHaveLength(4)
  })

  test("roundtrip preserves entity structure", () => {
    const json = JSON.stringify(DxFactoryGraph)
    const parsed = JSON.parse(json)

    const host = parsed.entities.host
    expect(host.kind).toBe("host")
    expect(host.prefix).toBe("host")
    expect(host.namespace).toBe("infra")
    expect(host.links.estate.target).toBe("estate")
    expect(host.schemas.spec.type).toBe("object")
    expect(host.schemas.spec.properties.hostname.type).toBe("string")
  })
})

describe("entity definitions", () => {
  test("all entity definitions have __kind marker", () => {
    const entities = [
      Team,
      Principal,
      Estate,
      Host,
      Realm,
      System,
      Component,
      Site,
      SystemDeployment,
      ComponentDeployment,
      Workbench,
    ]

    for (const entity of entities) {
      expect(entity.__kind).toBe(entity.kind)
    }
  })

  test("component spec has 14 type enum values", () => {
    const cmp = DxFactoryGraph.entities.component
    const typeSchema = cmp.schemas.spec.properties?.type
    expect(typeSchema?.enum).toHaveLength(14)
    expect(typeSchema?.enum).toContain("service")
    expect(typeSchema?.enum).toContain("agent")
    expect(typeSchema?.enum).toContain("database")
  })
})
