import {
  compileOntology,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Addressable,
  Junction,
} from "../schema/index"

export * from "./org"
export * from "./infra"
export * from "./software"
export * from "./ops"
export * from "./build"
export * from "./commerce"

import {
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
  Membership,
  ThreadParticipant,
  ThreadChannel,
} from "./org"

import {
  Estate,
  Host,
  Realm,
  Service,
  Route,
  DnsDomain,
  IpAddress,
  NetworkLink,
  RealmHost,
} from "./infra"

import {
  System,
  Component,
  SoftwareApi,
  Artifact,
  Release,
  Template,
  Product,
  Capability,
  ProductSystem,
  ReleaseArtifactPin,
} from "./software"

import {
  Site,
  Tenant,
  SystemDeployment,
  DeploymentSet,
  ComponentDeployment,
  Rollout,
  OpsDatabase,
  WorkbenchSnapshot,
  Workbench,
} from "./ops"

import {
  GitHostProvider,
  Repo,
  PipelineRun,
  WorkTrackerProvider,
  WorkTrackerProject,
  WorkItem,
  SystemVersion,
  ComponentArtifact,
} from "./build"

import {
  Customer,
  Plan,
  Subscription,
  BillableMetric,
  SubscriptionItem,
  EntitlementBundle,
} from "./commerce"

export const FactoryOntology = compileOntology(
  [
    // Org
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
    // Infra
    Estate,
    Host,
    Realm,
    Service,
    Route,
    DnsDomain,
    IpAddress,
    NetworkLink,
    // Software
    System,
    Component,
    SoftwareApi,
    Artifact,
    Release,
    Template,
    Product,
    Capability,
    // Ops
    Site,
    Tenant,
    SystemDeployment,
    DeploymentSet,
    ComponentDeployment,
    Rollout,
    OpsDatabase,
    WorkbenchSnapshot,
    Workbench,
    // Build
    GitHostProvider,
    Repo,
    PipelineRun,
    WorkTrackerProvider,
    WorkTrackerProject,
    WorkItem,
    SystemVersion,
    // Commerce
    Customer,
    Plan,
    Subscription,
    BillableMetric,
    // Junctions
    Membership,
    RealmHost,
    ProductSystem,
    ThreadParticipant,
    ThreadChannel,
    ReleaseArtifactPin,
    ComponentArtifact,
    SubscriptionItem,
    EntitlementBundle,
  ],
  { traits: [Reconcilable, Bitemporal, TeamOwned, Addressable, Junction] }
)
