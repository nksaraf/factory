import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

export const HealthStatus = Schema.Literal(
  "healthy",
  "unhealthy",
  "starting",
  "none"
)

export const OverallStatus = Schema.Literal("healthy", "degraded", "unhealthy")

export const SiteMode = Schema.Literal("dev", "up", "controller")

export const ReconcileEventType = Schema.Literal(
  "reconcile-start",
  "reconcile-complete",
  "reconcile-error",
  "step-applied",
  "step-failed",
  "condition-set"
)

export class ComponentHealth extends Schema.Class<ComponentHealth>(
  "ComponentHealth"
)({
  name: Schema.String,
  status: HealthStatus,
}) {}

export class HealthSnapshotRpc extends Schema.Class<HealthSnapshotRpc>(
  "HealthSnapshotRpc"
)({
  components: Schema.Record({ key: Schema.String, value: HealthStatus }),
  overallStatus: OverallStatus,
  checkedAt: Schema.String,
}) {}

export class ComponentStatus extends Schema.Class<ComponentStatus>(
  "ComponentStatus"
)({
  name: Schema.String,
  status: Schema.String,
  mode: Schema.String,
}) {}

export class SiteCondition extends Schema.Class<SiteCondition>("SiteCondition")(
  {
    type: Schema.String,
    status: Schema.Boolean,
  }
) {}

export class SiteStatusRpc extends Schema.Class<SiteStatusRpc>("SiteStatusRpc")(
  {
    mode: SiteMode,
    phase: Schema.String,
    components: Schema.Array(ComponentStatus),
    conditions: Schema.Array(SiteCondition),
  }
) {}

export class ReconcileStepError extends Schema.Class<ReconcileStepError>(
  "ReconcileStepError"
)({
  step: Schema.String,
  error: Schema.String,
}) {}

export class ReconcileResultRpc extends Schema.Class<ReconcileResultRpc>(
  "ReconcileResultRpc"
)({
  success: Schema.Boolean,
  stepsApplied: Schema.Number,
  stepsTotal: Schema.Number,
  errors: Schema.Array(ReconcileStepError),
  durationMs: Schema.Number,
  reconciliationId: Schema.String,
}) {}

export class ReconcileEventRpc extends Schema.Class<ReconcileEventRpc>(
  "ReconcileEventRpc"
)({
  timestamp: Schema.String,
  reconciliationId: Schema.String,
  type: ReconcileEventType,
  details: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
}) {}

export class HealthChangeEventRpc extends Schema.Class<HealthChangeEventRpc>(
  "HealthChangeEventRpc"
)({
  components: Schema.Record({ key: Schema.String, value: HealthStatus }),
  overallStatus: OverallStatus,
  checkedAt: Schema.String,
}) {}

export class LogLine extends Schema.Class<LogLine>("LogLine")({
  line: Schema.String,
}) {}

export class WorkbenchRpcs extends RpcGroup.make(
  Rpc.make("SiteStatus", {
    success: SiteStatusRpc,
  }),

  Rpc.make("SiteHealth", {
    success: HealthSnapshotRpc,
  }),

  Rpc.make("SiteReconcile", {
    success: ReconcileResultRpc,
    error: Schema.String,
    payload: {
      dryRun: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    },
  }),

  Rpc.make("ServiceRestart", {
    success: Schema.Void,
    error: Schema.String,
    payload: {
      name: Schema.String,
    },
  }),

  Rpc.make("SiteEvents", {
    success: ReconcileEventRpc,
    stream: true,
  }),

  Rpc.make("HealthChanges", {
    success: HealthChangeEventRpc,
    stream: true,
  }),

  Rpc.make("ServiceLogs", {
    success: LogLine,
    stream: true,
    payload: {
      name: Schema.String,
      tail: Schema.optionalWith(Schema.Number, { default: () => 200 }),
    },
  })
) {}
