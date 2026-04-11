export type SandboxType = "docker" | "firecracker" | "noop"

export interface SandboxAdapter {
  readonly type: string

  provision(
    sandbox: {
      systemDeploymentId: string
      name: string
      namespace?: string
    },
    opts: {
      dependencies?: Array<{
        name: string
        image: string
        port: number
        env?: Record<string, unknown>
      }>
      publishPorts?: number[]
    }
  ): Promise<{ externalUrl?: string; status: "provisioning" | "active" }>

  destroy(sandboxId: string): Promise<void>

  run(
    sandboxId: string,
    command: string[],
    opts?: {
      workdir?: string
      env?: Record<string, string>
      interactive?: boolean
      tty?: boolean
    }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>

  copyTo(
    sandboxId: string,
    localPath: string,
    remotePath: string
  ): Promise<void>

  copyFrom(
    sandboxId: string,
    remotePath: string,
    localPath: string
  ): Promise<void>

  snapshot(
    sandboxId: string
  ): Promise<{ snapshotId: string; config: Record<string, unknown> }>

  restore(
    snapshotId: string,
    snapshotConfig: Record<string, unknown>
  ): Promise<{ systemDeploymentId: string; name: string }>

  getStatus(
    sandboxId: string
  ): Promise<{ status: string; ports?: Array<{ port: number; url?: string }> }>
}
