import { Schema } from "effect"
import {
  RecoverySuggestion,
  CommonSuggestions,
} from "@smp/factory-shared/effect/errors"

const Suggestions = Schema.optional(Schema.Array(RecoverySuggestion))

function suggest(
  action: string,
  description: string,
  opts?: { command?: string; agentActionable?: boolean }
): RecoverySuggestion {
  return new RecoverySuggestion({ action, description, ...opts })
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class ExecutorError extends Schema.TaggedError<ExecutorError>()(
  "ExecutorError",
  {
    executor: Schema.String,
    operation: Schema.String,
    component: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `${this.executor} ${this.operation} failed for ${this.component}${suffix}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "EXECUTOR_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      executor: this.executor,
      operation: this.operation,
      component: this.component,
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(
          `docker compose logs ${this.component}`,
          "Check container logs for details",
          { agentActionable: true }
        ),
        CommonSuggestions.rerunVerbose(),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

export class ProcessSpawnError extends Schema.TaggedError<ProcessSpawnError>()(
  "ProcessSpawnError",
  {
    component: Schema.String,
    cmd: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Failed to start dev server for ${this.component}${suffix}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "PROCESS_SPAWN_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return { component: this.component, cmd: this.cmd.join(" ") }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(`cat .dx/dev/${this.component}.log`, "Check dev server log", {
          agentActionable: true,
        }),
        suggest(
          `which ${this.cmd[0] ?? "unknown"}`,
          "Verify the runtime is installed",
          { agentActionable: true }
        ),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------

export class DockerNotAvailableError extends Schema.TaggedError<DockerNotAvailableError>()(
  "DockerNotAvailableError",
  {
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return "Docker is not running"
  }

  get httpStatus(): number {
    return 503
  }

  get errorCode(): string {
    return "DOCKER_NOT_AVAILABLE"
  }

  get cliMetadata(): Record<string, unknown> {
    return {}
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest("open -a Docker", "Start Docker Desktop", {
          agentActionable: true,
        }),
        CommonSuggestions.checkStatus(),
      ]
    )
  }
}

export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
  component: Schema.String,
  cause: Schema.optional(Schema.String),
  suggestions: Suggestions,
}) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Docker build failed for ${this.component}${suffix}`
  }

  get httpStatus(): number {
    return 500
  }

  get errorCode(): string {
    return "BUILD_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return { component: this.component }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(
          `docker compose build ${this.component}`,
          "Rebuild to see full output",
          { agentActionable: true }
        ),
        suggest("dx dev --no-build", "Skip builds and use cached images"),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Manifest / Controller
// ---------------------------------------------------------------------------

export class ManifestError extends Schema.TaggedError<ManifestError>()(
  "ManifestError",
  {
    reason: Schema.String,
    version: Schema.optional(Schema.Number),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const ver = this.version != null ? ` (v${this.version})` : ""
    return `Manifest error${ver}: ${this.reason}`
  }

  get httpStatus(): number {
    return 422
  }

  get errorCode(): string {
    return "MANIFEST_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      reason: this.reason,
      ...(this.version != null ? { version: this.version } : {}),
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.healState()]
  }
}

export class ControlPlaneLinkError extends Schema.TaggedError<ControlPlaneLinkError>()(
  "ControlPlaneLinkError",
  {
    operation: Schema.String,
    statusCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const status = this.statusCode ? ` (${this.statusCode})` : ""
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Control plane ${this.operation} failed${status}${suffix}`
  }

  get httpStatus(): number {
    return 502
  }

  get errorCode(): string {
    return "CONTROL_PLANE_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return {
      operation: this.operation,
      ...(this.statusCode != null ? { statusCode: this.statusCode } : {}),
    }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        CommonSuggestions.login(),
        suggest("dx config get factory.url", "Verify Factory URL is correct", {
          agentActionable: true,
        }),
        suggest("--standalone", "Run without Factory connection"),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Component / Topology
// ---------------------------------------------------------------------------

export class ComponentNotFoundError extends Schema.TaggedError<ComponentNotFoundError>()(
  "ComponentNotFoundError",
  {
    component: Schema.String,
    available: Schema.Array(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Component not found: ${this.component}`
  }

  get httpStatus(): number {
    return 404
  }

  get errorCode(): string {
    return "COMPONENT_NOT_FOUND"
  }

  get cliMetadata(): Record<string, unknown> {
    return { component: this.component, available: this.available }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest("dx catalog tree", "Show available components", {
          agentActionable: true,
        }),
      ]
    )
  }
}

export class CircularDependencyError extends Schema.TaggedError<CircularDependencyError>()(
  "CircularDependencyError",
  {
    components: Schema.Array(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Circular dependency detected: ${this.components.join(" → ")}`
  }

  get httpStatus(): number {
    return 422
  }

  get errorCode(): string {
    return "CIRCULAR_DEPENDENCY"
  }

  get cliMetadata(): Record<string, unknown> {
    return { components: this.components }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest("dx catalog tree", "Inspect dependency graph", {
          agentActionable: true,
        }),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Tunnel
// ---------------------------------------------------------------------------

export class TunnelError extends Schema.TaggedError<TunnelError>()(
  "TunnelError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Tunnel ${this.operation} failed${suffix}`
  }

  get httpStatus(): number {
    return 502
  }

  get errorCode(): string {
    return "TUNNEL_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return { operation: this.operation }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return this.suggestions ?? [CommonSuggestions.checkConnectivity()]
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export class ConnectionError extends Schema.TaggedError<ConnectionError>()(
  "ConnectionError",
  {
    profile: Schema.String,
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `Connection to "${this.profile}" failed${suffix}`
  }

  get httpStatus(): number {
    return 502
  }

  get errorCode(): string {
    return "CONNECTION_ERROR"
  }

  get cliMetadata(): Record<string, unknown> {
    return { profile: this.profile }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        CommonSuggestions.checkConnectivity(),
        suggest(`dx dev --connect-to ${this.profile}`, "Retry the connection", {
          agentActionable: true,
        }),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Probes / Finalizers (kubelet patterns)
// ---------------------------------------------------------------------------

export class ProbeFailedError extends Schema.TaggedError<ProbeFailedError>()(
  "ProbeFailedError",
  {
    component: Schema.String,
    probeType: Schema.Literal("liveness", "readiness", "startup"),
    cause: Schema.optional(Schema.String),
    suggestions: Suggestions,
  }
) {
  get message(): string {
    const suffix = this.cause ? `: ${this.cause}` : ""
    return `${this.probeType} probe failed for ${this.component}${suffix}`
  }

  get httpStatus(): number {
    return 503
  }

  get errorCode(): string {
    return "PROBE_FAILED"
  }

  get cliMetadata(): Record<string, unknown> {
    return { component: this.component, probeType: this.probeType }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(`dx dev logs ${this.component}`, "Check component logs", {
          agentActionable: true,
        }),
        suggest(`dx dev restart ${this.component}`, "Restart the component", {
          agentActionable: true,
        }),
      ]
    )
  }
}

export class FinalizerTimeoutError extends Schema.TaggedError<FinalizerTimeoutError>()(
  "FinalizerTimeoutError",
  {
    component: Schema.String,
    finalizer: Schema.String,
    suggestions: Suggestions,
  }
) {
  get message(): string {
    return `Finalizer "${this.finalizer}" timed out for ${this.component}`
  }

  get httpStatus(): number {
    return 504
  }

  get errorCode(): string {
    return "FINALIZER_TIMEOUT"
  }

  get cliMetadata(): Record<string, unknown> {
    return { component: this.component, finalizer: this.finalizer }
  }

  get effectiveSuggestions(): readonly RecoverySuggestion[] {
    return (
      this.suggestions ?? [
        suggest(`dx dev stop ${this.component}`, "Force stop the component", {
          agentActionable: true,
        }),
      ]
    )
  }
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type SiteError =
  | ExecutorError
  | ProcessSpawnError
  | DockerNotAvailableError
  | BuildError
  | ManifestError
  | ControlPlaneLinkError
  | ComponentNotFoundError
  | CircularDependencyError
  | TunnelError
  | ConnectionError
  | ProbeFailedError
  | FinalizerTimeoutError
