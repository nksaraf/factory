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

export type ExecutorType = "compose" | "kubernetes"

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
    return { type: "compose", executor: new ComposeExecutor(config) }
  }

  const kubeconfigExists =
    existsSync(join(cwd, "kubeconfig.yaml")) ||
    existsSync(join(cwd, ".kube", "config")) ||
    !!process.env.KUBECONFIG

  if (kubeconfigExists) {
    return { type: "kubernetes", executor: new KubernetesExecutor() }
  }

  const dockerCheck = await shellCapture(["docker", "compose", "version"], {
    cwd,
    noSecrets: true,
  })
  if (dockerCheck.exitCode === 0) {
    return {
      type: "compose",
      executor: new ComposeExecutor({ composeFiles: [], cwd }),
    }
  }

  throw new Error(
    `No supported executor found in ${cwd}. Expected docker-compose.yaml or kubeconfig.`
  )
}
