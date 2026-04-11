import { logger } from "../logger"
import type { SandboxAdapter } from "./sandbox-adapter"

export class NoopSandboxAdapter implements SandboxAdapter {
  readonly type = "noop"

  async provision(
    sandbox: { systemDeploymentId: string; name: string; namespace?: string },
    opts: {
      dependencies?: Array<{
        name: string
        image: string
        port: number
        env?: Record<string, unknown>
      }>
      publishPorts?: number[]
    }
  ): Promise<{ externalUrl?: string; status: "provisioning" | "active" }> {
    logger.info({ sandbox, opts }, "noop sandbox adapter: provision")
    return { status: "active" }
  }

  async destroy(sandboxId: string): Promise<void> {
    logger.info({ sandboxId }, "noop sandbox adapter: destroy")
  }

  async run(
    sandboxId: string,
    command: string[],
    opts?: {
      workdir?: string
      env?: Record<string, string>
      interactive?: boolean
      tty?: boolean
    }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    logger.info({ sandboxId, command, opts }, "noop sandbox adapter: run")
    return { exitCode: 0, stdout: "", stderr: "" }
  }

  async copyTo(
    sandboxId: string,
    localPath: string,
    remotePath: string
  ): Promise<void> {
    logger.info(
      { sandboxId, localPath, remotePath },
      "noop sandbox adapter: copyTo"
    )
  }

  async copyFrom(
    sandboxId: string,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    logger.info(
      { sandboxId, remotePath, localPath },
      "noop sandbox adapter: copyFrom"
    )
  }

  async snapshot(
    sandboxId: string
  ): Promise<{ snapshotId: string; config: Record<string, unknown> }> {
    logger.info({ sandboxId }, "noop sandbox adapter: snapshot")
    return { snapshotId: "snap_noop_" + Date.now(), config: {} }
  }

  async restore(
    snapshotId: string,
    snapshotConfig: Record<string, unknown>
  ): Promise<{ systemDeploymentId: string; name: string }> {
    logger.info({ snapshotId, snapshotConfig }, "noop sandbox adapter: restore")
    return { systemDeploymentId: "dt_noop", name: "noop-restored" }
  }

  async getStatus(sandboxId: string): Promise<{
    status: string
    ports?: Array<{ port: number; url?: string }>
  }> {
    logger.info({ sandboxId }, "noop sandbox adapter: getStatus")
    return { status: "active" }
  }
}
