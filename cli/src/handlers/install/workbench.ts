import { select } from "@crustjs/prompts";
import ora from "ora";
import { run } from "../../lib/subprocess.js";
import { styleSuccess, styleMuted } from "../../cli-style.js";

interface WorkbenchResult {
  factoryUrl: string;
  user?: string;
  context?: string;
  dockerAvailable: boolean;
}

export async function runWorkbenchSetup(opts: {
  factoryUrl: string;
  verbose?: boolean;
}): Promise<WorkbenchResult> {
  const result: WorkbenchResult = {
    factoryUrl: opts.factoryUrl,
    dockerAvailable: false,
  };

  // Phase: Auth — reuse the existing dx auth login flow
  const authSpinner = ora({ text: "Authenticating...", prefixText: " " }).start();
  try {
    const { createFactoryAuthClient } = await import("../../auth-factory.js");
    const authClient = await createFactoryAuthClient();
    const { getStoredBearerToken } = await import("../../session-token.js");
    const token = await getStoredBearerToken();
    if (token) {
      authSpinner.succeed("Authenticated");
      result.user = "authenticated";
    } else {
      authSpinner.warn("Auth skipped — run `dx auth login` later");
    }
  } catch {
    authSpinner.warn("Auth skipped — run `dx auth login` later");
  }

  // Phase: Context selection
  try {
    const { getFactoryClient } = await import("../../client.js");
    const client = await getFactoryClient(opts.factoryUrl);
    const res = await client.api.v1.factory.fleet.sites.get();
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      const sites = res.data as Array<{ name: string }>;
      const chosen = await select({
        message: "Context",
        choices: sites.map((s) => ({ value: s.name, label: s.name })),
      });
      result.context = chosen;
    } else {
      result.context = new URL(opts.factoryUrl).hostname;
      console.log(`  ${styleMuted(`Context: ${result.context}`)}`);
    }
  } catch {
    result.context = new URL(opts.factoryUrl).hostname;
    console.log(`  ${styleMuted("Context setup skipped — configure with `dx context set`")}`);
  }

  // Phase: Docker check
  const dockerResult = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (dockerResult.status === 0) {
    const dockerVersion = dockerResult.stdout.trim();
    const composeResult = run("docker", ["compose", "version", "--short"]);
    const composeVersion = composeResult.status === 0 ? composeResult.stdout.trim() : "not found";
    console.log(`  ${styleSuccess("✔")} Docker ${dockerVersion}  Compose ${composeVersion}`);
    result.dockerAvailable = true;
  } else {
    console.log(`  ${styleMuted("Docker not found — optional, needed for dx dev")}`);
  }

  return result;
}
