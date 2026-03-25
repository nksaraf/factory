const OVERRIDES_KEY = "devtools:env-overrides"
const ORIGINALS_KEY = "devtools:env-originals"

/**
 * Patches globalThis.RIO_ENV with stored overrides.
 * Must be called BEFORE EnvService is constructed (i.e., before rio.ts is imported).
 */
export function applyEnvOverrides() {
  const raw = globalThis.RIO_ENV
  if (!raw) return

  // Snapshot originals (only once — first boot after overrides are set)
  if (!localStorage.getItem(ORIGINALS_KEY)) {
    localStorage.setItem(ORIGINALS_KEY, JSON.stringify(raw))
  }

  const overrides = localStorage.getItem(OVERRIDES_KEY)
  if (overrides) {
    try {
      Object.assign(raw, JSON.parse(overrides))
    } catch {}
  }
}

export function getEnvOverrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}")
  } catch {
    return {}
  }
}

export function getOriginalEnvValues(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ORIGINALS_KEY) || "{}")
  } catch {
    return {}
  }
}

export function setEnvOverride(key: string, value: string) {
  const current = getEnvOverrides()
  current[key] = value
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(current))
}

export function removeEnvOverride(key: string) {
  const current = getEnvOverrides()
  delete current[key]
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(current))
}

export function clearAllEnvOverrides() {
  localStorage.removeItem(OVERRIDES_KEY)
  localStorage.removeItem(ORIGINALS_KEY)
}

export function hasEnvOverrides(): boolean {
  return Object.keys(getEnvOverrides()).length > 0
}
