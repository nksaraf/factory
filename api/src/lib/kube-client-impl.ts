import { writeFileSync, existsSync, unlinkSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KubeClient, KubeResource, ExecResult } from "./kube-client"

/**
 * Resolve kubeconfig to a file path. If it's already a path, return it.
 * If it's inline YAML, write it to a temp file and return the path.
 */
function resolveKubeconfigPath(kubeconfig: string): {
  path: string
  cleanup: () => void
} {
  if (
    (kubeconfig.startsWith("/") || kubeconfig.startsWith("~")) &&
    existsSync(kubeconfig)
  ) {
    return { path: kubeconfig, cleanup: () => {} }
  }
  const tmp = join(
    tmpdir(),
    `kubeconfig-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`
  )
  writeFileSync(tmp, kubeconfig, { mode: 0o600 })
  return {
    path: tmp,
    cleanup: () => {
      try {
        unlinkSync(tmp)
      } catch {}
    },
  }
}

/**
 * Run kubectl with the given args and optional stdin, returning stdout.
 * Uses kubectl subprocess to avoid @kubernetes/client-node CRD discovery bugs.
 */
function kubectl(
  kubeconfigPath: string,
  args: string[],
  opts?: { stdin?: string; timeout?: number }
): string {
  return execFileSync("kubectl", ["--kubeconfig", kubeconfigPath, ...args], {
    input: opts?.stdin,
    encoding: "utf-8",
    timeout: opts?.timeout ?? 60_000,
    maxBuffer: 10 * 1024 * 1024,
  })
}

export class KubeClientImpl implements KubeClient {
  async apply(kubeconfig: string, resource: KubeResource): Promise<void> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      kubectl(
        kcPath,
        ["apply", "--server-side", "--force-conflicts", "-f", "-"],
        { stdin: JSON.stringify(resource) }
      )
    } finally {
      cleanup()
    }
  }

  async get(
    kubeconfig: string,
    kind: string,
    namespace: string,
    name: string
  ): Promise<KubeResource | null> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      const output = kubectl(kcPath, [
        "get",
        kind,
        name,
        "-n",
        namespace,
        "-o",
        "json",
      ])
      return JSON.parse(output) as KubeResource
    } catch (err: unknown) {
      if (isNotFoundKubectl(err)) return null
      throw err
    } finally {
      cleanup()
    }
  }

  async list(
    kubeconfig: string,
    kind: string,
    namespace: string,
    labelSelector?: string
  ): Promise<KubeResource[]> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      const args = ["get", kind, "-n", namespace, "-o", "json"]
      if (labelSelector) args.push("-l", labelSelector)
      const output = kubectl(kcPath, args)
      const parsed = JSON.parse(output)
      return (parsed.items ?? []) as KubeResource[]
    } finally {
      cleanup()
    }
  }

  async remove(
    kubeconfig: string,
    kind: string,
    namespace: string,
    name: string
  ): Promise<void> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      kubectl(kcPath, [
        "delete",
        kind,
        name,
        "-n",
        namespace,
        "--ignore-not-found",
        "--wait=false",
      ])
    } finally {
      cleanup()
    }
  }

  async execInPod(
    kubeconfig: string,
    namespace: string,
    podName: string,
    container: string,
    command: string[],
    opts?: { timeoutMs?: number }
  ): Promise<ExecResult> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      const stdout = kubectl(
        kcPath,
        ["exec", podName, "-n", namespace, "-c", container, "--", ...command],
        { timeout: opts?.timeoutMs ?? 300_000 }
      )
      return { exitCode: 0, stdout, stderr: "" }
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null) {
        const e = err as { status?: number; stdout?: string; stderr?: string }
        return {
          exitCode: e.status ?? 1,
          stdout: String(e.stdout ?? ""),
          stderr: String(e.stderr ?? ""),
        }
      }
      return { exitCode: 1, stdout: "", stderr: String(err) }
    } finally {
      cleanup()
    }
  }

  async getDeploymentImage(
    kubeconfig: string,
    namespace: string,
    deploymentName: string
  ): Promise<string | null> {
    const resource = await this.get(
      kubeconfig,
      "Deployment",
      namespace,
      deploymentName
    )
    if (!resource) return null
    const spec = (resource as unknown as Record<string, any>).spec
    return spec?.template?.spec?.containers?.[0]?.image ?? null
  }

  async pauseNode(kubeconfig: string, nodeName: string): Promise<void> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      kubectl(kcPath, ["cordon", nodeName])
    } finally {
      cleanup()
    }
  }

  async resumeNode(kubeconfig: string, nodeName: string): Promise<void> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      kubectl(kcPath, ["uncordon", nodeName])
    } finally {
      cleanup()
    }
  }

  async evacuateNode(kubeconfig: string, nodeName: string): Promise<void> {
    const { path: kcPath, cleanup } = resolveKubeconfigPath(kubeconfig)
    try {
      kubectl(kcPath, [
        "drain",
        nodeName,
        "--ignore-daemonsets",
        "--delete-emptydir-data",
        "--force",
      ])
    } finally {
      cleanup()
    }
  }
}

function isNotFoundKubectl(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "stderr" in err) {
    const stderr = String((err as { stderr: unknown }).stderr)
    return stderr.includes("NotFound") || stderr.includes("not found")
  }
  return false
}
