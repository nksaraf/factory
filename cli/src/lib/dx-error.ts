/**
 * Structured CLI error with operation context, metadata, and recovery hints.
 *
 * Convention:
 *   - New code that catches and re-throws MUST wrap in DxError with context.
 *   - Code that handles errors inline can use plain Error.
 *   - The top-level handler in cli.ts renders context, suggestions, and
 *     (with --verbose) the full stack + cause chain.
 */

export interface DxErrorContext {
  /** What operation was being attempted (e.g., "creating workspace", "applying k8s resource"). */
  operation: string
  /** Key-value pairs of relevant state (e.g., { workspaceSlug, realmId, kubeconfig }). */
  metadata?: Record<string, unknown>
  /** Actionable recovery suggestions shown to the user. */
  suggestions?: Array<{ action: string; description: string }>
  /** Machine-readable error code (e.g., "K3D_UNREACHABLE", "API_ERROR"). */
  code?: string
  /** The underlying cause, if wrapping another error. */
  cause?: Error
}

export class DxError extends Error {
  readonly context: DxErrorContext

  constructor(message: string, context: DxErrorContext) {
    super(message)
    this.name = "DxError"
    this.context = context
    if (context.cause) this.cause = context.cause
  }

  /** Wrap any caught value into a DxError, preserving the original as cause. */
  static wrap(err: unknown, context: Omit<DxErrorContext, "cause">): DxError {
    const cause = err instanceof Error ? err : new Error(String(err))
    return new DxError(cause.message, { ...context, cause })
  }
}
