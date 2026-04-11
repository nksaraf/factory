/**
 * Executor auto-detection — determines which execution method is available.
 */
import { discoverComposeFiles } from "@smp/factory-shared/formats/docker-compose.adapter"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { shellCapture } from "../../lib/shell.js"
import { ComposeExecutor, type ComposeExecutorConfig } from "./compose.js"
import type { Executor } from "./executor.js"
import { KubernetesExecutor } from "./kubernetes.js"

export type ExecutorType = "docker-compose" | "kubernetes"

/** Human-readable executor name for logs and CLI tables. */
export function formatExecutorTypeLabel(type: string | undefined): string {
  switch (type) {
    case "docker-compose":
      return "Docker Compose"
    case "kubernetes":
      return "Kubernetes"
    default:
      return type ?? ""
  }
}

export interface DetectResult {
  type: ExecutorType
  executor: Executor
}

export async function detectExecutor(
  cwd: string,
  projectName?: string
): Promise<DetectResult> {
  const composeFiles = discoverComposeFiles(cwd)
  if (composeFiles.length > 0) {
    const config: ComposeExecutorConfig = {
      composeFiles,
      projectName,
      cwd,
    }
    return { type: "docker-compose", executor: new ComposeExecutor(config) }
  }

  const kubeconfigExists =
    existsSync(join(cwd, "kubeconfig.yaml")) ||
    existsSync(join(cwd, ".kube", "config")) ||
    !!process.env.KUBECONFIG

  if (kubeconfigExists) {
    return { type: "kubernetes", executor: new KubernetesExecutor() }
  }

  const dockerComposeCli = await shellCapture(["docker", "compose", "version"], {
    cwd,
    noSecrets: true,
  })
  if (dockerComposeCli.exitCode === 0) {
    return {
      type: "docker-compose",
      executor: new ComposeExecutor({ composeFiles: [], cwd }),
    }
  }

  throw new Error(
    `No supported executor found in ${cwd}. Expected a Docker Compose file (e.g. docker-compose.yaml) or Kubernetes kubeconfig.`
  )
}
