import { run } from "../../lib/subprocess.js";
import { getKubeconfig } from "./k3s.js";
import { DX_NAMESPACE } from "./helm.js";
import type { InstallRole } from "@smp/factory-shared/install-types";
import { printTable } from "../../output.js";

export interface HealthCheckOptions {
  role: InstallRole;
  domain: string;
  verbose?: boolean;
}

interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  detail: string;
}

/** Phase 6: Health verification with exponential backoff. */
export async function verifyHealth(opts: HealthCheckOptions): Promise<boolean> {
  console.log("Running health verification...");

  const checks = await runAllChecks(opts);
  const allHealthy = checks.every((c) => c.status === "healthy");

  // Print summary table
  const table = printTable(
    ["Service", "Status", "Detail"],
    checks.map((c) => [c.name, c.status, c.detail])
  );
  console.log("\n" + table + "\n");

  if (allHealthy) {
    console.log("All health checks passed.");
  } else {
    const failed = checks.filter((c) => c.status !== "healthy");
    console.error(`${failed.length} health check(s) failed.`);
  }

  return allHealthy;
}

async function runAllChecks(opts: HealthCheckOptions): Promise<ServiceHealth[]> {
  const checks: ServiceHealth[] = [];

  // Check k3s nodes
  checks.push(await checkK3sNodes(opts.verbose));

  // Check dx-system pods
  checks.push(await checkPods(opts.verbose));

  // Check dx-api health endpoint
  checks.push(await checkApiHealth(opts.domain, opts.verbose));

  // Check TLS (non-blocking)
  checks.push(await checkTls(opts.domain, opts.verbose));

  // Factory-only: check additional planes
  if (opts.role === "factory") {
    checks.push(await checkFactoryPlane("builder", opts.domain, opts.verbose));
    checks.push(await checkFactoryPlane("fleet", opts.domain, opts.verbose));
    checks.push(await checkFactoryPlane("commerce", opts.domain, opts.verbose));
  }

  return checks;
}

async function checkK3sNodes(verbose?: boolean): Promise<ServiceHealth> {
  const result = run("kubectl", [
    "get", "nodes",
    "--kubeconfig", getKubeconfig(),
    "-o", "jsonpath={.items[*].status.conditions[?(@.type=='Ready')].status}",
  ]);

  if (result.status !== 0) {
    return { name: "k3s-nodes", status: "down", detail: "Cannot query nodes" };
  }

  const statuses = result.stdout.split(" ");
  const allReady = statuses.length > 0 && statuses.every((s) => s === "True");
  return {
    name: "k3s-nodes",
    status: allReady ? "healthy" : "degraded",
    detail: allReady ? `${statuses.length} node(s) Ready` : "Some nodes not Ready",
  };
}

async function checkPods(verbose?: boolean): Promise<ServiceHealth> {
  const result = run("kubectl", [
    "get", "pods", "-n", DX_NAMESPACE,
    "--kubeconfig", getKubeconfig(),
    "-o", "jsonpath={.items[*].status.phase}",
  ]);

  if (result.status !== 0) {
    return { name: "dx-system-pods", status: "down", detail: "Cannot query pods" };
  }

  const phases = result.stdout.split(" ").filter(Boolean);
  const allGood = phases.length > 0 && phases.every((p) => p === "Running" || p === "Succeeded");
  return {
    name: "dx-system-pods",
    status: allGood ? "healthy" : "degraded",
    detail: allGood ? `${phases.length} pod(s) running` : `Some pods not ready: ${phases.join(", ")}`,
  };
}

async function checkApiHealth(domain: string, verbose?: boolean): Promise<ServiceHealth> {
  const apiBase = `https://${domain}`;
  const maxAttempts = 10;
  let delay = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    const result = run("curl", ["-sf", `${apiBase}/health`, "--max-time", "5", "-k"]);
    if (result.status === 0) {
      return { name: "dx-api", status: "healthy", detail: "Health endpoint OK" };
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 15_000);
  }

  return { name: "dx-api", status: "down", detail: "Health endpoint not responding" };
}

async function checkTls(domain: string, verbose?: boolean): Promise<ServiceHealth> {
  const result = run("curl", ["-sf", `https://${domain}`, "--max-time", "5"]);
  if (result.status === 0) {
    return { name: "tls", status: "healthy", detail: "TLS certificate valid" };
  }
  // TLS may take time for letsencrypt — report as degraded, not down
  return { name: "tls", status: "degraded", detail: "TLS not yet valid (may still be provisioning)" };
}

async function checkFactoryPlane(
  plane: string,
  domain: string,
  verbose?: boolean
): Promise<ServiceHealth> {
  const apiBase = `https://${domain}`;
  const result = run("curl", [
    "-sf", `${apiBase}/api/v1/${plane}/health`,
    "--max-time", "5", "-k",
  ]);

  if (result.status === 0) {
    return { name: `${plane}-plane`, status: "healthy", detail: "Responding" };
  }
  return { name: `${plane}-plane`, status: "degraded", detail: "Not responding" };
}
