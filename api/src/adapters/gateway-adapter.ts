export interface GatewayCRD {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace: string
    labels: Record<string, string>
  }
  spec: Record<string, unknown>
}

export interface ApplyResult {
  applied: number
  errors: Array<{ name: string; error: string }>
}

export type GatewayType = "file" | "kubernetes" | "noop";

export interface GatewayAdapter {
  readonly type: string
  apply(crds: GatewayCRD[]): Promise<ApplyResult>
  getCurrentState(): Promise<GatewayCRD[]>
  delete(names: string[]): Promise<void>
}
