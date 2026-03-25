export interface ReconcileResult {
  success: boolean
  manifestVersion: number
  appliedCRDs: number
  deletedCRDs: number
  errors: Array<{ name: string; error: string }>
  timestamp: string
}

export interface SiteStatus {
  mode: "polling" | "push" | "idle"
  currentManifestVersion: number
  lastReconcileAt: string | null
  lastReconcileResult: ReconcileResult | null
  adapterType: string
}
