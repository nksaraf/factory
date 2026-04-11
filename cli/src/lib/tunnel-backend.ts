import type {
  TunnelBackendKind,
  TunnelSpec,
} from "@smp/factory-shared/connection-context-schemas"

export interface TunnelHandle {
  spec: TunnelSpec
  pid?: number
  status: "starting" | "healthy" | "unhealthy" | "stopped"
}

export interface TunnelBackend {
  readonly kind: TunnelBackendKind
  start(spec: TunnelSpec): Promise<TunnelHandle>
  stop(handle: TunnelHandle): Promise<void>
  checkHealth(handle: TunnelHandle): Promise<boolean>
}

export interface TunnelStatus {
  name: string
  localPort: number
  remoteHost: string
  remotePort: number
  backend: TunnelBackendKind
  status: TunnelHandle["status"]
  connectionString?: string
}
