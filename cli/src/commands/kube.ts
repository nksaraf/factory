import type { DxBase } from "../dx-root.js";
import { readConfig } from "../config.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("kube", [
  "$ dx kube get pods                 Forward to kubectl",
  "$ dx kube logs deployment/api      View pod logs",
]);

export function kubeCommand(app: DxBase) {
  return app
    .sub("kube")
    .meta({
      description: "Run kubectl against the configured cluster (all args after 'kube' are forwarded)",
    })
    .run(async () => {
      const config = await readConfig();
      const kubeconfig = config.kubeconfig;

      if (!kubeconfig) {
        console.error("No cluster configured. Run `dx install` first.");
        process.exit(1);
      }

      const { existsSync } = await import("node:fs");
      if (!existsSync(kubeconfig)) {
        console.error(`Kubeconfig not found at ${kubeconfig}. Re-run \`dx install\` to reconfigure.`);
        process.exit(1);
      }

      // Grab everything after "kube" from argv and forward to kubectl
      const idx = process.argv.indexOf("kube");
      const kubectlArgs = idx >= 0 ? process.argv.slice(idx + 1) : [];

      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("kubectl", [...kubectlArgs, "--kubeconfig", kubeconfig], {
        stdio: "inherit",
      });

      process.exit(result.status ?? 1);
    });
}
