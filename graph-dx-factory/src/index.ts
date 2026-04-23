import {
  compileGraph,
  Reconcilable,
  Bitemporal,
  TeamOwned,
  Addressable,
} from "@smp/graph"
import {
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
  Customer,
  Plan,
  Subscription,
  SubscriptionItem,
  EntitlementBundle,
  BillableMetric,
} from "./entities/index"

export * from "./entities/index"

export const DxFactoryGraph = compileGraph(
  [
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
    Customer,
    Plan,
    Subscription,
    SubscriptionItem,
    EntitlementBundle,
    BillableMetric,
  ],
  { traits: [Reconcilable, Bitemporal, TeamOwned, Addressable] }
)
