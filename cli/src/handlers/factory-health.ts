import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { styleBold, styleError, styleSuccess, styleWarn } from "../cli-style.js";
import { getFactoryClient } from "../client.js";
import { readConfig, resolveFactoryUrl } from "../config.js";
import type { DxFlags } from "../stub.js";

type HealthBody = { status?: string; service?: string };

interface ServiceCheck {
  name: string;
  status: "ok" | "degraded" | "unreachable";
  detail?: string;
}

export async function runFactoryHealth(flags: DxFlags): Promise<void> {
  const config = await readConfig();
  const factoryUrl = resolveFactoryUrl(config);
  const checks: ServiceCheck[] = [];

  // --- Factory API ---
  try {
    const api = await getFactoryClient();
    const res = await api.health.get();
    const data = res.data as HealthBody | undefined;
    if (data?.status) {
      checks.push({
        name: "Factory API",
        status: "ok",
        detail: `${data.status} (${data.service ?? "factory-api"})`,
      });
    } else {
      checks.push({
        name: "Factory API",
        status: "degraded",
        detail: "Health endpoint returned unexpected response",
      });
    }
  } catch (err) {
    checks.push({
      name: "Factory API",
      status: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // --- Auth service ---
  try {
    const { createFactoryAuthClient } = await import("../auth-factory.js");
    const client = await createFactoryAuthClient(flags);
    const session = await client.getSession();
    if (session.error) {
      checks.push({
        name: "Auth Service",
        status: "ok",
        detail: "reachable (no active session)",
      });
    } else {
      checks.push({
        name: "Auth Service",
        status: "ok",
        detail: `authenticated as ${session.data?.user?.email ?? "unknown"}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "Auth Service",
      status: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // --- Cluster (if kubeconfig is set) ---
  if (config.kubeconfig) {
    try {
      const { spawnSync } = await import("node:child_process");
      const proc = spawnSync("kubectl", ["get", "nodes", "--kubeconfig", config.kubeconfig, "-o", "name"], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (proc.status === 0) {
        const nodeCount = (proc.stdout || "").trim().split("\n").filter(Boolean).length;
        checks.push({
          name: "Cluster",
          status: "ok",
          detail: `${nodeCount} node${nodeCount !== 1 ? "s" : ""}`,
        });
      } else {
        checks.push({
          name: "Cluster",
          status: "unreachable",
          detail: (proc.stderr || "").trim().split("\n")[0],
        });
      }
    } catch (err) {
      checks.push({
        name: "Cluster",
        status: "unreachable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Output ---
  const allOk = checks.every((c) => c.status === "ok");

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: allOk,
          data: { factoryUrl, checks },
          exitCode: allOk ? 0 : ExitCodes.CONNECTION_FAILURE,
        },
        null,
        2
      )
    );
    if (!allOk) process.exit(ExitCodes.CONNECTION_FAILURE);
    return;
  }

  console.log(styleBold(`Factory Health — ${factoryUrl}`));
  console.log("");

  for (const check of checks) {
    const icon =
      check.status === "ok" ? styleSuccess("\u2713") :
      check.status === "degraded" ? styleWarn("\u26A0") :
      styleError("\u2717");
    const detail = check.detail ? `  ${check.detail}` : "";
    console.log(`  ${icon} ${styleBold(check.name)}${detail}`);
  }

  console.log("");
  if (allOk) {
    console.log(styleSuccess("All services healthy."));
  } else {
    console.log(styleWarn("Some services are degraded or unreachable."));
    process.exit(ExitCodes.CONNECTION_FAILURE);
  }
}
