import type { InstallRole } from "@smp/factory-shared/install-types"

/** Categories of machine-level defaults that dx setup configures. */
export type Category =
  | "git"
  | "npm"
  | "curl"
  | "psql"
  | "docker"
  | "ssh"
  | "system"
  | "shell"
  | "ide-hooks"

/** A single proposed change to the developer environment. */
export interface ConfigChange {
  /** Unique key for idempotency tracking, e.g. "git:push.autoSetupRemote" */
  id: string
  /** Human-readable category for grouping in output */
  category: Category
  /** What will be changed */
  description: string
  /** The file or config system being modified */
  target: string
  /** Current value (null if not set) */
  currentValue: string | null
  /** Proposed value */
  proposedValue: string
  /** Whether this change is already in the desired state */
  alreadyApplied: boolean
  /** Whether applying requires elevated privileges (sudo) */
  requiresSudo: boolean
  /** Platform restriction (null = all platforms) */
  platform: "darwin" | "linux" | "win32" | null
  /** Apply the change. Returns true on success. */
  apply: () => Promise<boolean>
}

/** A provider that detects current state and proposes changes. */
export interface ConfigProvider {
  name: string
  category: Category
  /** Which roles this provider applies to. */
  roles: InstallRole[]
  /** Detect current config state and return proposed changes. */
  detect: () => Promise<ConfigChange[]>
}

/** Result of a full defaults scan. */
export interface DefaultsScanResult {
  /** All proposed changes, including already-applied ones */
  all: ConfigChange[]
  /** Only changes that need to be applied */
  pending: ConfigChange[]
  /** Changes that are already in the desired state */
  applied: ConfigChange[]
}

/** Result of applying defaults. */
export interface ApplyResult {
  applied: string[]
  failed: string[]
  skipped: string[]
  backedUp: string[]
}
