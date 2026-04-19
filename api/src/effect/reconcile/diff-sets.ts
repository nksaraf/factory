export interface DiffSetsOptions<D, O> {
  readonly desired: ReadonlyArray<D>
  readonly observed: ReadonlyArray<O>
  readonly keyOfDesired: (d: D) => string
  readonly keyOfObserved: (o: O) => string
  readonly isEqual?: (d: D, o: O) => boolean
}

export interface DiffSetsResult<D, O> {
  readonly toCreate: ReadonlyArray<D>
  readonly toUpdate: ReadonlyArray<{ desired: D; observed: O }>
  readonly toOrphan: ReadonlyArray<O>
  readonly skipped: ReadonlyArray<{ desired: D; observed: O }>
}

export function diffSets<D, O>(
  options: DiffSetsOptions<D, O>
): DiffSetsResult<D, O> {
  const { desired, observed, keyOfDesired, keyOfObserved, isEqual } = options

  const observedMap = new Map<string, O>()
  for (const o of observed) {
    observedMap.set(keyOfObserved(o), o)
  }

  const toCreate: D[] = []
  const toUpdate: Array<{ desired: D; observed: O }> = []
  const skipped: Array<{ desired: D; observed: O }> = []

  for (const d of desired) {
    const key = keyOfDesired(d)
    const o = observedMap.get(key)
    if (o === undefined) {
      toCreate.push(d)
    } else if (isEqual && isEqual(d, o)) {
      skipped.push({ desired: d, observed: o })
    } else {
      toUpdate.push({ desired: d, observed: o })
    }
  }

  const desiredKeys = new Set(desired.map(keyOfDesired))
  const toOrphan: O[] = []
  for (const o of observed) {
    if (!desiredKeys.has(keyOfObserved(o))) {
      toOrphan.push(o)
    }
  }

  return { toCreate, toUpdate, toOrphan, skipped }
}
