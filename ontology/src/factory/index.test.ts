import { describe, expect, test } from "bun:test"
import {
  FactoryOntology,
  Team,
  Principal,
  Agent,
  Scope,
  IdentityLink,
  Channel,
  Thread,
  Document,
  Event,
  EventSubscription,
  ConfigVar,
  OrgSecret,
  Estate,
  Host,
  Realm,
  Service,
  Route,
  DnsDomain,
  IpAddress,
  NetworkLink,
  System,
  Component,
  SoftwareApi,
  Artifact,
  Release,
  Template,
  Product,
  Capability,
  Site,
  Tenant,
  SystemDeployment,
  DeploymentSet,
  ComponentDeployment,
  Rollout,
  OpsDatabase,
  WorkbenchSnapshot,
  Workbench,
  GitHostProvider,
  Repo,
  PipelineRun,
  WorkTrackerProvider,
  WorkTrackerProject,
  WorkItem,
  SystemVersion,
  Customer,
  Plan,
  Subscription,
  BillableMetric,
} from "./index"

describe("FactoryOntology", () => {
  test("compiles without errors", () => {
    expect(FactoryOntology).toBeDefined()
    expect(FactoryOntology.$schema).toBe("https://ontology.dev/ir/v1")
    expect(FactoryOntology.version).toBe("1.0")
  })

  test("has 6 namespaces", () => {
    const ns = Object.keys(FactoryOntology.namespaces).sort()
    expect(ns).toEqual(["build", "commerce", "infra", "ops", "org", "software"])
  })

  test("org namespace has all entities", () => {
    const org = FactoryOntology.namespaces.org
    expect(org.entityKinds).toContain("team")
    expect(org.entityKinds).toContain("principal")
    expect(org.entityKinds).toContain("agent")
    expect(org.entityKinds).toContain("scope")
    expect(org.entityKinds).toContain("identityLink")
    expect(org.entityKinds).toContain("channel")
    expect(org.entityKinds).toContain("thread")
    expect(org.entityKinds).toContain("document")
    expect(org.entityKinds).toContain("event")
    expect(org.entityKinds).toContain("eventSubscription")
    expect(org.entityKinds).toContain("configVar")
    expect(org.entityKinds).toContain("orgSecret")
    expect(org.entityKinds).toContain("membership")
    expect(org.entityKinds).toContain("thread-participant")
    expect(org.entityKinds).toContain("thread-channel")
  })

  test("infra namespace has all entities", () => {
    const infra = FactoryOntology.namespaces.infra
    expect(infra.entityKinds).toContain("estate")
    expect(infra.entityKinds).toContain("host")
    expect(infra.entityKinds).toContain("realm")
    expect(infra.entityKinds).toContain("service")
    expect(infra.entityKinds).toContain("route")
    expect(infra.entityKinds).toContain("dnsDomain")
    expect(infra.entityKinds).toContain("ipAddress")
    expect(infra.entityKinds).toContain("networkLink")
    expect(infra.entityKinds).toContain("realm-host")
  })

  test("software namespace has all entities", () => {
    const sw = FactoryOntology.namespaces.software
    expect(sw.entityKinds).toContain("system")
    expect(sw.entityKinds).toContain("component")
    expect(sw.entityKinds).toContain("softwareApi")
    expect(sw.entityKinds).toContain("artifact")
    expect(sw.entityKinds).toContain("release")
    expect(sw.entityKinds).toContain("template")
    expect(sw.entityKinds).toContain("product")
    expect(sw.entityKinds).toContain("capability")
    expect(sw.entityKinds).toContain("product-system")
    expect(sw.entityKinds).toContain("release-artifact-pin")
  })

  test("ops namespace has all entities", () => {
    const ops = FactoryOntology.namespaces.ops
    expect(ops.entityKinds).toContain("site")
    expect(ops.entityKinds).toContain("tenant")
    expect(ops.entityKinds).toContain("systemDeployment")
    expect(ops.entityKinds).toContain("deploymentSet")
    expect(ops.entityKinds).toContain("componentDeployment")
    expect(ops.entityKinds).toContain("rollout")
    expect(ops.entityKinds).toContain("opsDatabase")
    expect(ops.entityKinds).toContain("workbenchSnapshot")
    expect(ops.entityKinds).toContain("workbench")
    expect(ops.entityKinds).toHaveLength(9)
  })

  test("build namespace has all entities", () => {
    const build = FactoryOntology.namespaces.build
    expect(build.entityKinds).toContain("gitHostProvider")
    expect(build.entityKinds).toContain("repo")
    expect(build.entityKinds).toContain("pipelineRun")
    expect(build.entityKinds).toContain("workTrackerProvider")
    expect(build.entityKinds).toContain("workTrackerProject")
    expect(build.entityKinds).toContain("workItem")
    expect(build.entityKinds).toContain("systemVersion")
    expect(build.entityKinds).toContain("component-artifact")
    expect(build.entityKinds).toHaveLength(8)
  })

  test("commerce namespace has all entities", () => {
    const commerce = FactoryOntology.namespaces.commerce
    expect(commerce.entityKinds).toContain("customer")
    expect(commerce.entityKinds).toContain("plan")
    expect(commerce.entityKinds).toContain("subscription")
    expect(commerce.entityKinds).toContain("billableMetric")
    expect(commerce.entityKinds).toContain("subscription-item")
    expect(commerce.entityKinds).toContain("entitlement-bundle")
    expect(commerce.entityKinds).toHaveLength(6)
  })

  test("each entity has expected kind, prefix, namespace", () => {
    const expectations = [
      { kind: "team", prefix: "team", namespace: "org" },
      { kind: "principal", prefix: "prin", namespace: "org" },
      { kind: "agent", prefix: "agt", namespace: "org" },
      { kind: "scope", prefix: "scope", namespace: "org" },
      { kind: "identityLink", prefix: "idlk", namespace: "org" },
      { kind: "channel", prefix: "chan", namespace: "org" },
      { kind: "thread", prefix: "thrd", namespace: "org" },
      { kind: "document", prefix: "doc", namespace: "org" },
      { kind: "event", prefix: "evt", namespace: "org" },
      { kind: "eventSubscription", prefix: "esub", namespace: "org" },
      { kind: "configVar", prefix: "cvar", namespace: "org" },
      { kind: "orgSecret", prefix: "sec", namespace: "org" },
      { kind: "estate", prefix: "est", namespace: "infra" },
      { kind: "host", prefix: "host", namespace: "infra" },
      { kind: "realm", prefix: "rlm", namespace: "infra" },
      { kind: "service", prefix: "svc", namespace: "infra" },
      { kind: "route", prefix: "rte", namespace: "infra" },
      { kind: "dnsDomain", prefix: "dom", namespace: "infra" },
      { kind: "ipAddress", prefix: "ipa", namespace: "infra" },
      { kind: "networkLink", prefix: "nlnk", namespace: "infra" },
      { kind: "system", prefix: "sys", namespace: "software" },
      { kind: "component", prefix: "cmp", namespace: "software" },
      { kind: "softwareApi", prefix: "api", namespace: "software" },
      { kind: "artifact", prefix: "art", namespace: "software" },
      { kind: "release", prefix: "rel", namespace: "software" },
      { kind: "template", prefix: "tmpl", namespace: "software" },
      { kind: "product", prefix: "prod", namespace: "software" },
      { kind: "capability", prefix: "cap", namespace: "software" },
      { kind: "site", prefix: "site", namespace: "ops" },
      { kind: "tenant", prefix: "tnt", namespace: "ops" },
      { kind: "systemDeployment", prefix: "sdp", namespace: "ops" },
      { kind: "deploymentSet", prefix: "dset", namespace: "ops" },
      { kind: "componentDeployment", prefix: "cdp", namespace: "ops" },
      { kind: "rollout", prefix: "rout", namespace: "ops" },
      { kind: "opsDatabase", prefix: "db", namespace: "ops" },
      { kind: "workbenchSnapshot", prefix: "wbsnap", namespace: "ops" },
      { kind: "workbench", prefix: "wbnch", namespace: "ops" },
      { kind: "gitHostProvider", prefix: "ghp", namespace: "build" },
      { kind: "repo", prefix: "repo", namespace: "build" },
      { kind: "pipelineRun", prefix: "prun", namespace: "build" },
      { kind: "workTrackerProvider", prefix: "wtp", namespace: "build" },
      { kind: "workTrackerProject", prefix: "wtpj", namespace: "build" },
      { kind: "workItem", prefix: "wi", namespace: "build" },
      { kind: "systemVersion", prefix: "sver", namespace: "build" },
      { kind: "customer", prefix: "cust", namespace: "commerce" },
      { kind: "plan", prefix: "pln", namespace: "commerce" },
      { kind: "subscription", prefix: "csub", namespace: "commerce" },
      { kind: "billableMetric", prefix: "bmet", namespace: "commerce" },
    ]

    for (const { kind, prefix, namespace } of expectations) {
      const entity = FactoryOntology.entities[kind]
      expect(entity).toBeDefined()
      expect(entity.prefix).toBe(prefix)
      expect(entity.namespace).toBe(namespace)
    }
  })
})

describe("entity links", () => {
  test("team has parent self-ref link", () => {
    const team = FactoryOntology.entities.team
    expect(team.links.parent).toBeDefined()
    expect(team.links.parent.target).toBe("team")
    expect(team.links.parent.fk).toBe("parentTeamId")
    expect(team.links.parent.cardinality).toBe("many-to-one")
  })

  test("host has estate link", () => {
    const host = FactoryOntology.entities.host
    expect(host.links.estate).toBeDefined()
    expect(host.links.estate.target).toBe("estate")
    expect(host.links.estate.fk).toBe("estateId")
    expect(host.links.estate.cardinality).toBe("many-to-one")
  })

  test("estate has hosts and realms one-to-many links", () => {
    const estate = FactoryOntology.entities.estate
    expect(estate.links.hosts).toBeDefined()
    expect(estate.links.hosts.target).toBe("host")
    expect(estate.links.hosts.cardinality).toBe("one-to-many")
    expect(estate.links.hosts.targetFk).toBe("estateId")

    expect(estate.links.realms).toBeDefined()
    expect(estate.links.realms.target).toBe("realm")
    expect(estate.links.realms.cardinality).toBe("one-to-many")
  })

  test("systemDeployment has dual lineage — both site and system links", () => {
    const sd = FactoryOntology.entities.systemDeployment
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
    const cd = FactoryOntology.entities.componentDeployment
    expect(cd.links.systemDeployment).toBeDefined()
    expect(cd.links.systemDeployment.target).toBe("systemDeployment")
    expect(cd.links.systemDeployment.required).toBe(true)

    expect(cd.links.component).toBeDefined()
    expect(cd.links.component.target).toBe("component")
    expect(cd.links.component.required).toBe(true)
  })

  test("workbench links to site, host, realm, and owner", () => {
    const wb = FactoryOntology.entities.workbench
    expect(wb.links.site.target).toBe("site")
    expect(wb.links.host.target).toBe("host")
    expect(wb.links.realm.target).toBe("realm")
    expect(wb.links.owner.target).toBe("principal")
  })

  test("component links to system", () => {
    const cmp = FactoryOntology.entities.component
    expect(cmp.links.system).toBeDefined()
    expect(cmp.links.system.target).toBe("system")
    expect(cmp.links.system.fk).toBe("systemId")
  })

  test("site has recursive parent link", () => {
    const site = FactoryOntology.entities.site
    expect(site.links.parent).toBeDefined()
    expect(site.links.parent.target).toBe("site")
    expect(site.links.parent.fk).toBe("parentSiteId")
  })

  test("agent links to principal and has self-ref reportsTo", () => {
    const agent = FactoryOntology.entities.agent
    expect(agent.links.principal).toBeDefined()
    expect(agent.links.principal.target).toBe("principal")
    expect(agent.links.principal.fk).toBe("principalId")
    expect(agent.links.principal.required).toBe(true)

    expect(agent.links.reportsTo).toBeDefined()
    expect(agent.links.reportsTo.target).toBe("agent")
    expect(agent.links.reportsTo.fk).toBe("reportsToAgentId")
  })

  test("thread links to principal, agent, channel, and parent", () => {
    const thread = FactoryOntology.entities.thread
    expect(thread.links.principal.target).toBe("principal")
    expect(thread.links.agent.target).toBe("agent")
    expect(thread.links.channel.target).toBe("channel")
    expect(thread.links.parent.target).toBe("thread")
  })

  test("tenant links to site and customer", () => {
    const tenant = FactoryOntology.entities.tenant
    expect(tenant.links.site.target).toBe("site")
    expect(tenant.links.site.required).toBe(true)
    expect(tenant.links.customer.target).toBe("customer")
    expect(tenant.links.customer.required).toBe(true)
  })

  test("repo links to system, gitHostProvider, and team", () => {
    const repo = FactoryOntology.entities.repo
    expect(repo.links.system.target).toBe("system")
    expect(repo.links.gitHostProvider.target).toBe("gitHostProvider")
    expect(repo.links.team.target).toBe("team")
  })

  test("subscription links to customer and plan", () => {
    const sub = FactoryOntology.entities.subscription
    expect(sub.links.customer.target).toBe("customer")
    expect(sub.links.customer.required).toBe(true)
    expect(sub.links.plan.target).toBe("plan")
    expect(sub.links.plan.required).toBe(true)
  })

  test("softwareApi links to system and component", () => {
    const api = FactoryOntology.entities.softwareApi
    expect(api.links.system.target).toBe("system")
    expect(api.links.system.required).toBe(true)
    expect(api.links.providedByComponent.target).toBe("component")
  })

  test("rollout links to release and systemDeployment", () => {
    const rollout = FactoryOntology.entities.rollout
    expect(rollout.links.release.target).toBe("release")
    expect(rollout.links.systemDeployment.target).toBe("systemDeployment")
    expect(rollout.links.systemDeployment.required).toBe(true)
  })
})

describe("traits", () => {
  test("estate has reconcilable trait", () => {
    const estate = FactoryOntology.entities.estate
    expect(estate.traits).toContain("reconcilable")
    expect(estate.reconciliation).toBe(true)
    expect(estate.derived.isConverged).toBeDefined()
    expect(estate.derived.isDrifted).toBeDefined()
  })

  test("system has bitemporal and team-owned traits", () => {
    const sys = FactoryOntology.entities.system
    expect(sys.traits).toContain("bitemporal")
    expect(sys.traits).toContain("team-owned")
    expect(sys.bitemporal).toBe(true)
    expect(sys.links.ownerTeam).toBeDefined()
    expect(sys.links.ownerTeam.target).toBe("team")
  })

  test("site has both reconcilable and bitemporal traits", () => {
    const site = FactoryOntology.entities.site
    expect(site.traits).toContain("reconcilable")
    expect(site.traits).toContain("bitemporal")
    expect(site.reconciliation).toBe(true)
    expect(site.bitemporal).toBe(true)
  })

  test("component has team-owned trait with ownerTeam link", () => {
    const cmp = FactoryOntology.entities.component
    expect(cmp.traits).toContain("team-owned")
    expect(cmp.links.ownerTeam).toBeDefined()
    expect(cmp.links.ownerTeam.target).toBe("team")
    expect(cmp.links.ownerTeam.fk).toBe("ownerTeamId")
  })

  test("team is bitemporal but not reconcilable", () => {
    const team = FactoryOntology.entities.team
    expect(team.bitemporal).toBe(true)
    expect(team.reconciliation).toBe(false)
    expect(team.traits).not.toContain("reconcilable")
  })

  test("capability has team-owned trait", () => {
    const cap = FactoryOntology.entities.capability
    expect(cap.traits).toContain("team-owned")
    expect(cap.links.ownerTeam).toBeDefined()
  })

  test("tenant has reconcilable and bitemporal traits", () => {
    const tenant = FactoryOntology.entities.tenant
    expect(tenant.traits).toContain("reconcilable")
    expect(tenant.traits).toContain("bitemporal")
  })

  test("repo has bitemporal trait", () => {
    const repo = FactoryOntology.entities.repo
    expect(repo.traits).toContain("bitemporal")
    expect(repo.bitemporal).toBe(true)
  })

  test("customer has bitemporal trait", () => {
    const customer = FactoryOntology.entities.customer
    expect(customer.traits).toContain("bitemporal")
    expect(customer.bitemporal).toBe(true)
  })

  test("rollout has reconcilable trait", () => {
    const rollout = FactoryOntology.entities.rollout
    expect(rollout.traits).toContain("reconcilable")
    expect(rollout.reconciliation).toBe(true)
  })

  test("service has reconcilable trait", () => {
    const service = FactoryOntology.entities.service
    expect(service.traits).toContain("reconcilable")
    expect(service.reconciliation).toBe(true)
  })

  test("networkLink has reconcilable trait", () => {
    const nlink = FactoryOntology.entities.networkLink
    expect(nlink.traits).toContain("reconcilable")
    expect(nlink.reconciliation).toBe(true)
  })
})

describe("serialization", () => {
  test("the IR is fully serializable to JSON", () => {
    const json = JSON.stringify(FactoryOntology)
    expect(json).toBeDefined()
    expect(typeof json).toBe("string")

    const parsed = JSON.parse(json)
    expect(parsed.$schema).toBe("https://ontology.dev/ir/v1")
    expect(Object.keys(parsed.entities)).toHaveLength(57)
    expect(Object.keys(parsed.namespaces)).toHaveLength(6)
  })

  test("roundtrip preserves entity structure", () => {
    const json = JSON.stringify(FactoryOntology)
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
      Agent,
      Scope,
      IdentityLink,
      Channel,
      Thread,
      Document,
      Event,
      EventSubscription,
      ConfigVar,
      OrgSecret,
      Estate,
      Host,
      Realm,
      Service,
      Route,
      DnsDomain,
      IpAddress,
      NetworkLink,
      System,
      Component,
      SoftwareApi,
      Artifact,
      Release,
      Template,
      Product,
      Capability,
      Site,
      Tenant,
      SystemDeployment,
      DeploymentSet,
      ComponentDeployment,
      Rollout,
      OpsDatabase,
      WorkbenchSnapshot,
      Workbench,
      GitHostProvider,
      Repo,
      PipelineRun,
      WorkTrackerProvider,
      WorkTrackerProject,
      WorkItem,
      SystemVersion,
      Customer,
      Plan,
      Subscription,
      BillableMetric,
    ]

    for (const entity of entities) {
      expect(entity.__kind).toBe(entity.kind)
    }
  })

  test("component spec has 14 type enum values", () => {
    const cmp = FactoryOntology.entities.component
    const typeSchema = cmp.schemas.spec.properties?.type
    expect(typeSchema?.enum).toHaveLength(14)
    expect(typeSchema?.enum).toContain("service")
    expect(typeSchema?.enum).toContain("agent")
    expect(typeSchema?.enum).toContain("database")
  })
})
