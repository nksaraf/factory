export interface SetDiff<D, O> {
  readonly toCreate: ReadonlyArray<D>
  readonly toUpdate: ReadonlyArray<{
    readonly desired: D
    readonly observed: O
  }>
  readonly toOrphan: ReadonlyArray<O>
}

export interface DiffSetsOptions<D, O> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean
}

/**
 * Compute a three-way set diff between desired and observed arrays.
 *
 * Returns items to create (in desired but not observed), update (in both),
 * and orphan (in observed but not desired), keyed by caller-supplied functions.
 *
 * Without `isEqual`, every key-matched pair lands in `toUpdate` — the caller
 * is responsible for defining what "equal" means for their domain.
 *
 * Duplicate keys in either array use last-occurrence-wins (Map semantics).
 */
export function diffSets<D, O = D>(
  options: DiffSetsOptions<D, O>
): SetDiff<D, O> {
  const { desired, observed, keyOfDesired, keyOfObserved, isEqual } = options

  // Build map from observed: last write wins for duplicates, but observed is keyed by its own key fn
  const observedMap = new Map<string, O>()
  for (const o of observed) {
    observedMap.set(keyOfObserved(o), o)
  }

  // Build map from desired: last wins for duplicate keys
  const desiredMap = new Map<string, D>()
  for (const d of desired) {
    desiredMap.set(keyOfDesired(d), d)
  }

  const toCreate: D[] = []
  const toUpdate: { desired: D; observed: O }[] = []

  for (const [key, d] of desiredMap) {
    const o = observedMap.get(key)
    if (o === undefined) {
      toCreate.push(d)
    } else if (isEqual === undefined || !isEqual(d, o)) {
      toUpdate.push({ desired: d, observed: o })
    }
  }

  const toOrphan: O[] = []
  for (const [key, o] of observedMap) {
    if (!desiredMap.has(key)) {
      toOrphan.push(o)
    }
  }

  return { toCreate, toUpdate, toOrphan }
}
