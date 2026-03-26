import { run, runInherit } from "../../lib/subprocess.js";
import { getKubeconfig } from "./k3s.js";
import { DX_NAMESPACE, RELEASE_NAME } from "./helm.js";

export interface UninstallOptions {
  keepK3s?: boolean;
  verbose?: boolean;
}

/** dx install uninstall — tear down dx platform and optionally k3s. */
export async function runUninstall(opts: UninstallOptions): Promise<void> {
  // 1. Helm uninstall
  console.log("Uninstalling dx-platform Helm release...");
  const helmResult = runInherit("helm", [
    "uninstall", RELEASE_NAME,
    "--namespace", DX_NAMESPACE,
    "--kubeconfig", getKubeconfig(),
  ], { verbose: opts.verbose });

  if (helmResult !== 0) {
    console.warn("Helm uninstall returned non-zero (release may not exist).");
  }

  // 2. Clean up namespace
  console.log("Deleting dx-system namespace...");
  runInherit("kubectl", [
    "delete", "namespace", DX_NAMESPACE,
    "--kubeconfig", getKubeconfig(),
    "--ignore-not-found",
  ], { verbose: opts.verbose });

  // 3. Optionally remove k3s
  if (!opts.keepK3s) {
    console.log("Uninstalling k3s...");
    const uninstallScript = "/usr/local/bin/k3s-uninstall.sh";
    const result = run("test", ["-f", uninstallScript]);
    if (result.status === 0) {
      runInherit("sh", [uninstallScript], { verbose: opts.verbose });
    } else {
      console.warn("k3s uninstall script not found — k3s may not be installed.");
    }
  } else {
    console.log("Keeping k3s (--keep-k3s specified).");
  }

  console.log("Uninstall complete.");
}
