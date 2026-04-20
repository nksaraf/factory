// Pure primitive
export { diffSets, type SetDiff, type DiffSetsOptions } from "./diff-sets"

// Effect combinator
export {
  reconcileSet,
  type ReconcileSetOptions,
  type ReconcileSetResult,
} from "./reconcile-set"

// Reconciler definition
export {
  Reconciler,
  type ReconcilerDef,
  type ReconcilerStatus,
} from "./reconciler"

// Runtime
export { createReconcilerRuntime, type ReconcilerRuntime } from "./runtime"

// Internal (exported for testing/advanced use)
export { makeDeduplicatingQueue, type DeduplicatingQueue } from "./dedup-queue"
export {
  makeCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from "./circuit-breaker"
